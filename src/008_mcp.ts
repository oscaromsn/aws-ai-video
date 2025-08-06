#!/usr/bin/env bun
import { AiTool, AiToolkit, McpSchema, McpServer } from "@effect/ai"
import { HttpClient, HttpClientRequest, HttpClientResponse, FetchHttpClient } from "@effect/platform"
import { BunRuntime, BunSink, BunStream } from "@effect/platform-bun"
import { Array, Effect, Layer, Logger, Schema } from "effect"

const idParam = McpSchema.param("id", Schema.NumberFromString)

const ReadmeTemplate = McpServer.resource`file://readme/${idParam}`({
  name: "README Template",
  completion: {
    id: (_) => Effect.succeed([1, 2, 3, 4, 5])
  },
  content: Effect.fn(function* (_uri, id) {
    return `# MCP Server Demo - ID: ${id}`
  })
})

const TestPrompt = McpServer.prompt({
  name: "Test Prompt",
  description: "A test prompt to demonstrate MCP server capabilities",
  parameters: Schema.Struct({
    flightNumber: Schema.String
  }),
  completion: {
    flightNumber: () => Effect.succeed(["FL123", "FL456", "FL789"])
  },
  content: ({ flightNumber }) =>
    Effect.succeed(
      `Get the booking details for flight number: ${flightNumber}`
    )
})

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

const DadJokeToolkit = McpServer.toolkit(DadJokeTools).pipe(
  Layer.provide(DadJokeToolHandlers)
)

const ServerLayer = Layer.mergeAll(ReadmeTemplate, TestPrompt, DadJokeToolkit).pipe(
  Layer.provide(
    McpServer.layerStdio({
      name: "Demo Server",
      version: "1.0.0",
      stdin: BunStream.stdin,
      stdout: BunSink.stdout
    })
  ),
  Layer.provide(Logger.add(Logger.prettyLogger({ stderr: true })))
)

Layer.launch(ServerLayer).pipe(BunRuntime.runMain)
