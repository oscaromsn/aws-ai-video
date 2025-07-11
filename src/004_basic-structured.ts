import { AiLanguageModel } from "@effect/ai"
import { AmazonBedrockClient, AmazonBedrockLanguageModel } from "@effect/ai-amazon-bedrock"
import { FetchHttpClient } from "@effect/platform"
import { BunRuntime } from "@effect/platform-bun"
import { Config, Console, Effect, Layer, Schema } from "effect"

const Pun = Schema.Struct({
  setup: Schema.String.annotations({
    description: "The opening line or premise of the joke—the “hook” that sets up the situation"
  }),
  punchline: Schema.String.annotations({
    description: "The payoff or twist that delivers the humor—typically follows the setup and completes the joke"
  }),
  explanation: Schema.String.annotations({
    description: "A brief note unpacking the wordplay or logic behind the joke—helps clarify puns or non-obvious twists"
  })
}).annotations({ description: "An object representing a pun or dad joke" })

const dadJoke = Effect.gen(function* () {
  const response = yield* AiLanguageModel.generateObject({
    prompt: "Tell me a really groan-inducing dad joke - don't hold back",
    schema: Pun
  })

  yield* Console.log(response.value)

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
