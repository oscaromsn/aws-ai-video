import { AiLanguageModel, AiTool, AiToolkit } from "@effect/ai"
import { AmazonBedrockClient, AmazonBedrockLanguageModel } from "@effect/ai-amazon-bedrock"
import { HttpClient, HttpClientRequest, HttpClientResponse, FetchHttpClient } from "@effect/platform"
import { BunRuntime } from "@effect/platform-bun"
import { Array, Config, Effect, Layer, Schema } from "effect"

class DadJokeTools extends AiToolkit.make(
  AiTool.make("GetDadJoke", {
    description: "Get a hilarious dad joke from the ICanHazDadJoke API",
    success: Schema.String,
    failure: Schema.Never,
    parameters: {
      searchTerm: Schema.String.annotations({
        description: "The search term to use to find dad jokes"
      })
    }
  })
) { }

class DadJoke extends Schema.Class<DadJoke>("DadJoke")({
  id: Schema.String,
  joke: Schema.String
}) { }

class SearchResponse extends Schema.Class<SearchResponse>("SearchResponse")({
  results: Schema.Array(DadJoke)
}) { }

class ICanHazDadJoke extends Effect.Service<ICanHazDadJoke>()("ICanHazDadJoke", {
  dependencies: [FetchHttpClient.layer],
  effect: Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient
    const httpClientOk = httpClient.pipe(
      HttpClient.filterStatusOk,
      HttpClient.mapRequest(HttpClientRequest.prependUrl("https://icanhazdadjoke.com"))
    )

    const search = Effect.fn("ICanHazDadJoke.search")(
      function* (searchTerm: string) {
        return yield* httpClientOk.get("/search", {
          acceptJson: true,
          urlParams: { term: searchTerm }
        }).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(SearchResponse)),
          Effect.flatMap(({ results }) => Array.head(results)),
          Effect.map((joke) => joke.joke),
          Effect.orDie
        )
      }
    )

    return {
      search
    } as const
  })
}) { }

const DadJokeToolHandlers = DadJokeTools.toLayer(
  Effect.gen(function* () {
    const icanhazdadjoke = yield* ICanHazDadJoke
    return {
      GetDadJoke: ({ searchTerm }) => icanhazdadjoke.search(searchTerm)
    }
  })
).pipe(Layer.provide(ICanHazDadJoke.Default))

const program = Effect.gen(function* () {
  const response = yield* AiLanguageModel.generateText({
    prompt: "Generate a dad joke about scientists",
    toolkit: DadJokeTools
  })
  if (response.finishReason === "tool-calls") {
    const nextResponse = yield* AiLanguageModel.generateText({
      prompt: response,
      toolkit: DadJokeTools
    })
    console.log(nextResponse.text)
  }
}).pipe(Effect.provide(AmazonBedrockLanguageModel.model("us.anthropic.claude-sonnet-4-20250514-v1:0")))

const AmazonBedrock = AmazonBedrockClient.layerConfig({
  accessKeyId: Config.string("AWS_ACCESS_KEY_ID"),
  secretAccessKey: Config.redacted("AWS_SECRET_ACCESS_KEY"),
  sessionToken: Config.redacted("AWS_SESSION_TOKEN")
}).pipe(Layer.provide(FetchHttpClient.layer))

program.pipe(
  Effect.provide([AmazonBedrock, DadJokeToolHandlers]),
  BunRuntime.runMain
)

