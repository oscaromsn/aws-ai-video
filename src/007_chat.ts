import { AiChat, AiTool, AiToolkit } from "@effect/ai"
import { AmazonBedrockClient, AmazonBedrockLanguageModel } from "@effect/ai-amazon-bedrock"
import { HttpClient, HttpClientRequest, HttpClientResponse, FetchHttpClient } from "@effect/platform"
import { BunRuntime } from "@effect/platform-bun"
import { Array, Config, Console, Effect, Layer, Schema, String } from "effect"

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
          urlParams: { searchTerm }
        }).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(SearchResponse)),
          Effect.flatMap(({ results }) => Array.head(results)),
          Effect.map((joke) => joke.joke),
          Effect.scoped,
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
  const chat = yield* AiChat.empty

  yield* chat.generateText({
    prompt: "Generate a dad joke about pirates",
    toolkit: DadJokeTools
  })

  const JokeAnalysis = Schema.Struct({
    joke: Schema.String.annotations({
      description: "The original dad joke that was submitted for analysis"
    }),
    type: Schema.Literal("pun", "one-liner", "wordplay", "absurd", "other").annotations({
      description: "Primary comedic mechanism of the joke"
    }),
    audience: Schema.Literal("kids", "teens", "adults", "all").annotations({
      description: "Intended or most-appropriate audience"
    }),
    explanation: Schema.String.annotations({
      description: "A brief, clear explanation of how the joke works"
    }),
    funninessRating: Schema.Number.annotations({
      description: "How funny the joke is on a scale from 1 (not funny) to 10 (hilarious)"
    })
  }).annotations({ description: "Represents an analysis of a dad joke or pun" })

  const analysis = yield* chat.generateObject({
    prompt: String.stripMargin(
      `|You are a dad-joke analysis assistant. Provide an analysis of the provided
       |joke. Respond **only** with a JSON object matching the specified JSON 
       |structure. Do not emit any extra fields or commentary.`
    ),
    schema: JokeAnalysis
  })

  yield* Console.log(analysis.value)
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

