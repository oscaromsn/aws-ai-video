import { AiLanguageModel } from "@effect/ai"
import { AmazonBedrockClient, AmazonBedrockLanguageModel } from "@effect/ai-amazon-bedrock"
import { FetchHttpClient } from "@effect/platform"
import { BunRuntime } from "@effect/platform-bun"
import { Config, Console, Effect, Layer } from "effect"

const dadJoke = Effect.gen(function* () {
  const response = yield* AiLanguageModel.generateText({
    prompt: "Tell me a really groan-inducing dad joke - don't hold back"
  })

  yield* Console.log(response.text)

  return response
})

const ClaudeSonnet = AmazonBedrockLanguageModel.model(
  "us.anthropic.claude-sonnet-4-20250514-v1:0"
)

const program = Effect.provide(dadJoke, ClaudeSonnet)

const AmazonBedrock = AmazonBedrockClient.layerConfig({
  accessKeyId: Config.string("AWS_ACCESS_KEY_ID"),
  secretAccessKey: Config.redacted("AWS_SECRET_ACCESS_KEY"),
  sessionToken: Config.redacted("AWS_SESSION_TOKEN")
}).pipe(Layer.provide(FetchHttpClient.layer))

program.pipe(
  Effect.provide(AmazonBedrock),
  BunRuntime.runMain
)
