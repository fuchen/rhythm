package expo.modules.rhythmworkouttimer

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.roundToLong

class RhythmWorkoutTimerModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("RhythmWorkoutTimer")

    AsyncFunction("start") { config: Map<String, Any?> ->
      val stages = (config["stages"] as? List<*>)
        ?.mapNotNull { rawStage ->
          val stage = rawStage as? Map<*, *> ?: return@mapNotNull null
          val durationSeconds = (stage["durationSec"] as? Number)?.toDouble()?.roundToLong() ?: return@mapNotNull null
          WorkoutStage(
            name = stage["name"] as? String ?: "当前阶段",
            cue = stage["cue"] as? String ?: "",
            durationMs = durationSeconds.coerceAtLeast(1) * 1_000,
            musicName = (stage["musicName"] as? String)?.takeIf(String::isNotBlank),
            musicUri = (stage["musicUri"] as? String)?.takeIf(String::isNotBlank)
          )
        }
        .orEmpty()

      require(stages.isNotEmpty()) { "Workout stages cannot be empty" }

      val stageIndex = ((config["stageIndex"] as? Number)?.toInt() ?: 0).coerceIn(stages.indices)
      val remainingMs = (((config["remainingSec"] as? Number)?.toDouble()?.roundToLong() ?: 1).coerceAtLeast(1)) * 1_000
      val intent = WorkoutTimerService.createStartIntent(
        context = context,
        planId = config["planId"] as? String ?: "",
        planTitle = config["planTitle"] as? String ?: "训练进行中",
        stages = stages,
        stageIndex = stageIndex,
        remainingMs = remainingMs,
        voiceEnabled = config["voiceEnabled"] as? Boolean ?: true,
        vibrationEnabled = config["vibrationEnabled"] as? Boolean ?: true,
        voiceVolume = ((config["voiceVolume"] as? Number)?.toFloat() ?: 1f).coerceIn(0f, 1f),
        musicVolume = ((config["musicVolume"] as? Number)?.toFloat() ?: 0.7f).coerceIn(0f, 1f),
        tickUri = (config["tickUri"] as? String)?.takeIf(String::isNotBlank)
      )
      ContextCompat.startForegroundService(context, intent)
    }

    AsyncFunction<Unit>("pause") {
      sendAction(WorkoutTimerService.ACTION_PAUSE)
    }

    AsyncFunction<Unit>("resume") {
      sendAction(WorkoutTimerService.ACTION_RESUME)
    }

    AsyncFunction<Unit>("skip") {
      sendAction(WorkoutTimerService.ACTION_SKIP)
    }

    AsyncFunction<Unit>("reset") {
      sendAction(WorkoutTimerService.ACTION_STOP)
    }

    AsyncFunction("getSnapshot") {
      WorkoutTimerState.snapshot(context)
    }
  }

  private fun sendAction(action: String) {
    context.startService(Intent(context, WorkoutTimerService::class.java).setAction(action))
  }
}
