package expo.modules.rhythmworkouttimer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.tts.TextToSpeech
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.util.UUID
import kotlin.math.ceil
import kotlin.math.max

data class WorkoutStage(val name: String, val cue: String, val durationMs: Long)

internal data class StoredWorkout(
  val planId: String,
  val planTitle: String,
  val stages: List<WorkoutStage>,
  val stageIndex: Int,
  val status: String,
  val endAtElapsed: Long,
  val remainingMs: Long,
  val voiceEnabled: Boolean,
  val vibrationEnabled: Boolean
)

internal object WorkoutTimerState {
  private const val PREFERENCES_NAME = "rhythm-workout-timer"
  private const val KEY_STATE = "state"

  fun save(context: Context, workout: StoredWorkout) {
    val stages = JSONArray().apply {
      workout.stages.forEach { stage ->
        put(JSONObject().apply {
          put("name", stage.name)
          put("cue", stage.cue)
          put("durationMs", stage.durationMs)
        })
      }
    }
    val state = JSONObject().apply {
      put("planId", workout.planId)
      put("planTitle", workout.planTitle)
      put("stages", stages)
      put("stageIndex", workout.stageIndex)
      put("status", workout.status)
      put("endAtElapsed", workout.endAtElapsed)
      put("remainingMs", workout.remainingMs)
      put("voiceEnabled", workout.voiceEnabled)
      put("vibrationEnabled", workout.vibrationEnabled)
    }
    context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_STATE, state.toString())
      .commit()
  }

  fun load(context: Context): StoredWorkout? {
    val rawState = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
      .getString(KEY_STATE, null) ?: return null
    return runCatching {
      val state = JSONObject(rawState)
      val rawStages = state.getJSONArray("stages")
      val stages = buildList {
        for (index in 0 until rawStages.length()) {
          val stage = rawStages.getJSONObject(index)
          add(WorkoutStage(stage.getString("name"), stage.optString("cue"), stage.getLong("durationMs")))
        }
      }
      StoredWorkout(
        planId = state.optString("planId"),
        planTitle = state.optString("planTitle", "训练进行中"),
        stages = stages,
        stageIndex = state.optInt("stageIndex").coerceIn(stages.indices),
        status = state.optString("status", "idle"),
        endAtElapsed = state.optLong("endAtElapsed"),
        remainingMs = state.optLong("remainingMs"),
        voiceEnabled = state.optBoolean("voiceEnabled", true),
        vibrationEnabled = state.optBoolean("vibrationEnabled", true)
      )
    }.getOrNull()
  }

  fun snapshot(context: Context): Map<String, Any?> {
    val workout = load(context) ?: return mapOf(
      "active" to false,
      "status" to "idle",
      "stageIndex" to 0,
      "remaining" to 0,
      "planId" to ""
    )
    val remainingMs = if (workout.status == "running") {
      max(0, workout.endAtElapsed - SystemClock.elapsedRealtime())
    } else {
      workout.remainingMs
    }
    return mapOf(
      "active" to (workout.status == "running" || workout.status == "paused"),
      "status" to workout.status,
      "stageIndex" to workout.stageIndex,
      "remaining" to ceil(remainingMs / 1_000.0).toInt(),
      "planId" to workout.planId
    )
  }
}

class WorkoutTimerService : Service(), TextToSpeech.OnInitListener {
  private val handler = Handler(Looper.getMainLooper())
  private val boundaryRunnable = Runnable { advanceAtBoundary() }
  private var workout: StoredWorkout? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var textToSpeech: TextToSpeech? = null
  private var textToSpeechReady = false
  private var pendingSpeech: String? = null

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
    textToSpeech = TextToSpeech(this, this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> startWorkout(intent)
      ACTION_PAUSE -> pauseWorkout()
      ACTION_RESUME -> resumeWorkout()
      ACTION_SKIP -> skipStage()
      ACTION_STOP -> stopWorkout()
      else -> restoreWorkout()
    }
    return if (workout?.status == "running" || workout?.status == "paused") START_STICKY else START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onInit(status: Int) {
    if (status != TextToSpeech.SUCCESS) return
    textToSpeechReady = true
    textToSpeech?.language = Locale.SIMPLIFIED_CHINESE
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      textToSpeech?.setAudioAttributes(speechAudioAttributes())
    }
    pendingSpeech?.let(::speak)
    pendingSpeech = null
  }

  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    releaseWakeLock()
    textToSpeech?.stop()
    textToSpeech?.shutdown()
    textToSpeech = null
    textToSpeechReady = false
    super.onDestroy()
  }

  private fun startWorkout(intent: Intent) {
    val names = intent.getStringArrayListExtra(EXTRA_STAGE_NAMES).orEmpty()
    val cues = intent.getStringArrayListExtra(EXTRA_STAGE_CUES).orEmpty()
    val durations = intent.getLongArrayExtra(EXTRA_STAGE_DURATIONS) ?: longArrayOf()
    val stages = names.mapIndexedNotNull { index, name ->
      durations.getOrNull(index)?.let { duration -> WorkoutStage(name, cues.getOrNull(index).orEmpty(), duration) }
    }
    if (stages.isEmpty()) {
      stopSelf()
      return
    }

    val stageIndex = intent.getIntExtra(EXTRA_STAGE_INDEX, 0).coerceIn(stages.indices)
    val remainingMs = intent.getLongExtra(EXTRA_REMAINING_MS, stages[stageIndex].durationMs).coerceAtLeast(1_000)
    workout = StoredWorkout(
      planId = intent.getStringExtra(EXTRA_PLAN_ID).orEmpty(),
      planTitle = intent.getStringExtra(EXTRA_PLAN_TITLE) ?: "训练进行中",
      stages = stages,
      stageIndex = stageIndex,
      status = "running",
      endAtElapsed = SystemClock.elapsedRealtime() + remainingMs,
      remainingMs = remainingMs,
      voiceEnabled = intent.getBooleanExtra(EXTRA_VOICE_ENABLED, true),
      vibrationEnabled = intent.getBooleanExtra(EXTRA_VIBRATION_ENABLED, true)
    )
    persistAndNotify()
    signalStage("开始${stages[stageIndex].name}，${stages[stageIndex].cue}")
    scheduleBoundary()
  }

  private fun restoreWorkout() {
    val restored = WorkoutTimerState.load(this) ?: run {
      stopSelf()
      return
    }
    if (restored.status != "running" && restored.status != "paused") {
      stopSelf()
      return
    }
    workout = restored
    startForeground(NOTIFICATION_ID, buildNotification(restored))
    if (restored.status == "running") {
      advanceAtBoundary()
    }
  }

  private fun pauseWorkout() {
    val current = workout ?: WorkoutTimerState.load(this) ?: return
    if (current.status != "running") return
    val remainingMs = max(0, current.endAtElapsed - SystemClock.elapsedRealtime())
    workout = current.copy(status = "paused", remainingMs = remainingMs)
    handler.removeCallbacks(boundaryRunnable)
    releaseWakeLock()
    persistAndNotify()
    controlBackgroundAudio(EXPO_AUDIO_ACTION_PAUSE)
  }

  private fun resumeWorkout() {
    val current = workout ?: WorkoutTimerState.load(this) ?: return
    if (current.status != "paused") return
    workout = current.copy(
      status = "running",
      endAtElapsed = SystemClock.elapsedRealtime() + current.remainingMs.coerceAtLeast(1_000)
    )
    persistAndNotify()
    controlBackgroundAudio(EXPO_AUDIO_ACTION_PLAY)
    scheduleBoundary()
  }

  private fun skipStage() {
    val current = workout ?: WorkoutTimerState.load(this) ?: return
    if (current.stageIndex >= current.stages.lastIndex) {
      completeWorkout()
      return
    }
    val nextIndex = current.stageIndex + 1
    val nextStage = current.stages[nextIndex]
    val now = SystemClock.elapsedRealtime()
    workout = current.copy(
      stageIndex = nextIndex,
      endAtElapsed = if (current.status == "running") now + nextStage.durationMs else current.endAtElapsed,
      remainingMs = nextStage.durationMs
    )
    persistAndNotify()
    signalStage("跳到${nextStage.name}。${nextStage.cue}")
    if (current.status == "running") scheduleBoundary()
  }

  private fun stopWorkout() {
    handler.removeCallbacksAndMessages(null)
    releaseWakeLock()
    val current = workout ?: WorkoutTimerState.load(this)
    current?.let { WorkoutTimerState.save(this, it.copy(status = "idle", remainingMs = 0)) }
    if (current?.status == "running" || current?.status == "paused") {
      controlBackgroundAudio(EXPO_AUDIO_ACTION_PAUSE)
    }
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun advanceAtBoundary() {
    val current = workout ?: return
    if (current.status != "running") return
    val now = SystemClock.elapsedRealtime()
    if (now < current.endAtElapsed) {
      scheduleBoundary()
      return
    }

    var nextIndex = current.stageIndex
    var nextEndAt = current.endAtElapsed
    while (now >= nextEndAt && nextIndex < current.stages.lastIndex) {
      nextIndex += 1
      nextEndAt += current.stages[nextIndex].durationMs
    }

    if (now >= nextEndAt) {
      completeWorkout()
      return
    }

    val nextStage = current.stages[nextIndex]
    workout = current.copy(stageIndex = nextIndex, endAtElapsed = nextEndAt, remainingMs = nextStage.durationMs)
    persistAndNotify()
    signalStage("接下来，${nextStage.name}。${nextStage.cue}")
    scheduleBoundary()
  }

  private fun completeWorkout() {
    val current = workout ?: return
    handler.removeCallbacks(boundaryRunnable)
    releaseWakeLock()
    workout = current.copy(status = "complete", remainingMs = 0)
    persistAndNotify()
    controlBackgroundAudio(EXPO_AUDIO_ACTION_PAUSE)
    signalStage("训练完成，做得很好！")
    stopForeground(STOP_FOREGROUND_DETACH)
    handler.postDelayed({ stopSelf() }, 15_000)
  }

  private fun persistAndNotify() {
    val current = workout ?: return
    WorkoutTimerState.save(this, current)
    startForeground(NOTIFICATION_ID, buildNotification(current))
  }

  private fun scheduleBoundary() {
    val current = workout ?: return
    if (current.status != "running") return
    handler.removeCallbacks(boundaryRunnable)
    val delayMs = max(1, current.endAtElapsed - SystemClock.elapsedRealtime())
    acquireWakeLock(delayMs + 60_000)
    handler.postDelayed(boundaryRunnable, delayMs)
  }

  private fun signalStage(message: String) {
    val current = workout ?: return
    if (current.vibrationEnabled) vibrate()
    if (current.voiceEnabled) {
      if (textToSpeechReady) speak(message) else pendingSpeech = message
    }
  }

  private fun speak(message: String) {
    val parameters = Bundle().apply { putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1f) }
    textToSpeech?.speak(message, TextToSpeech.QUEUE_FLUSH, parameters, UUID.randomUUID().toString())
  }

  private fun vibrate() {
    val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      vibrator.vibrate(VibrationEffect.createOneShot(300, VibrationEffect.DEFAULT_AMPLITUDE))
    } else {
      @Suppress("DEPRECATION")
      vibrator.vibrate(300)
    }
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(CHANNEL_ID, "训练计时", NotificationManager.IMPORTANCE_LOW).apply {
      description = "锁屏时保持训练阶段计时"
      setSound(null, null)
      enableVibration(false)
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun buildNotification(current: StoredWorkout): Notification {
    val stage = current.stages[current.stageIndex]
    val remainingMs = if (current.status == "running") {
      max(0, current.endAtElapsed - SystemClock.elapsedRealtime())
    } else {
      current.remainingMs
    }
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle(if (current.status == "complete") "训练完成" else stage.name)
      .setContentText(if (current.status == "paused") "已暂停 · ${formatRemaining(remainingMs)}" else current.planTitle)
      .setContentIntent(contentPendingIntent())
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOnlyAlertOnce(true)
      .setOngoing(current.status == "running" || current.status == "paused")
      .setAutoCancel(current.status == "complete")

    if (current.status == "running") {
      builder
        .setWhen(System.currentTimeMillis() + remainingMs)
        .setUsesChronometer(true)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) builder.setChronometerCountDown(true)
      builder.addAction(android.R.drawable.ic_media_pause, "暂停", servicePendingIntent(ACTION_PAUSE, 1))
    } else if (current.status == "paused") {
      builder.addAction(android.R.drawable.ic_media_play, "继续", servicePendingIntent(ACTION_RESUME, 2))
    }
    if (current.status == "running" || current.status == "paused") {
      if (current.stageIndex < current.stages.lastIndex) {
        builder.addAction(android.R.drawable.ic_media_next, "下一阶段", servicePendingIntent(ACTION_SKIP, 3))
      }
      builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "结束", servicePendingIntent(ACTION_STOP, 4))
    }
    return builder.build()
  }

  private fun contentPendingIntent(): PendingIntent? {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    launchIntent.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    return PendingIntent.getActivity(this, 0, launchIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun servicePendingIntent(action: String, requestCode: Int): PendingIntent {
    val intent = Intent(this, WorkoutTimerService::class.java).setAction(action)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getService(this, requestCode, intent, flags)
  }

  private fun formatRemaining(remainingMs: Long): String {
    val totalSeconds = ceil(remainingMs / 1_000.0).toInt()
    return "%02d:%02d".format(totalSeconds / 60, totalSeconds % 60)
  }

  private fun acquireWakeLock(timeoutMs: Long) {
    releaseWakeLock()
    val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:workout-timer").apply {
      acquire(timeoutMs.coerceAtLeast(60_000))
    }
  }

  private fun releaseWakeLock() {
    wakeLock?.takeIf { it.isHeld }?.release()
    wakeLock = null
  }

  private fun speechAudioAttributes() = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
    .build()

  private fun controlBackgroundAudio(action: String) {
    val intent = Intent()
      .setClassName(packageName, "expo.modules.audio.service.AudioControlsService")
      .setAction(action)
    startService(intent)
  }

  companion object {
    const val ACTION_START = "expo.modules.rhythmworkouttimer.START"
    const val ACTION_PAUSE = "expo.modules.rhythmworkouttimer.PAUSE"
    const val ACTION_RESUME = "expo.modules.rhythmworkouttimer.RESUME"
    const val ACTION_SKIP = "expo.modules.rhythmworkouttimer.SKIP"
    const val ACTION_STOP = "expo.modules.rhythmworkouttimer.STOP"

    private const val EXTRA_PLAN_ID = "planId"
    private const val EXTRA_PLAN_TITLE = "planTitle"
    private const val EXTRA_STAGE_NAMES = "stageNames"
    private const val EXTRA_STAGE_CUES = "stageCues"
    private const val EXTRA_STAGE_DURATIONS = "stageDurations"
    private const val EXTRA_STAGE_INDEX = "stageIndex"
    private const val EXTRA_REMAINING_MS = "remainingMs"
    private const val EXTRA_VOICE_ENABLED = "voiceEnabled"
    private const val EXTRA_VIBRATION_ENABLED = "vibrationEnabled"
    private const val CHANNEL_ID = "rhythm-workout-timer"
    private const val NOTIFICATION_ID = 7_421
    private const val EXPO_AUDIO_ACTION_PLAY = "expo.modules.audio.action.PLAY"
    private const val EXPO_AUDIO_ACTION_PAUSE = "expo.modules.audio.action.PAUSE"

    fun createStartIntent(
      context: Context,
      planId: String,
      planTitle: String,
      stages: List<WorkoutStage>,
      stageIndex: Int,
      remainingMs: Long,
      voiceEnabled: Boolean,
      vibrationEnabled: Boolean
    ) = Intent(context, WorkoutTimerService::class.java).apply {
      action = ACTION_START
      putExtra(EXTRA_PLAN_ID, planId)
      putExtra(EXTRA_PLAN_TITLE, planTitle)
      putStringArrayListExtra(EXTRA_STAGE_NAMES, ArrayList(stages.map(WorkoutStage::name)))
      putStringArrayListExtra(EXTRA_STAGE_CUES, ArrayList(stages.map(WorkoutStage::cue)))
      putExtra(EXTRA_STAGE_DURATIONS, stages.map(WorkoutStage::durationMs).toLongArray())
      putExtra(EXTRA_STAGE_INDEX, stageIndex)
      putExtra(EXTRA_REMAINING_MS, remainingMs)
      putExtra(EXTRA_VOICE_ENABLED, voiceEnabled)
      putExtra(EXTRA_VIBRATION_ENABLED, vibrationEnabled)
    }
  }
}
