import { LanguageModel, Tool, Toolkit } from "@effect/ai";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform";
import { BunRuntime } from "@effect/platform-bun";
import { Array, Config, Effect, Layer, Option, pipe, Schema } from "effect";

class DadJokeTools extends Toolkit.make(
  Tool.make("GetDadJoke", {
    description: "Get a hilarious dad joke from the ICanHazDadJoke API",
    success: Schema.String,
    failure: Schema.Never,
    parameters: {
      searchTerm: Schema.String.annotations({
        description: "The search term to use to find dad jokes",
      }),
    },
  })
) {}

class DadJoke extends Schema.Class<DadJoke>("DadJoke")({
  id: Schema.String,
  joke: Schema.String,
}) {}

class SearchResponse extends Schema.Class<SearchResponse>("SearchResponse")({
  results: Schema.Array(DadJoke),
}) {}

class ICanHazDadJoke extends Effect.Service<ICanHazDadJoke>()(
  "ICanHazDadJoke",
  {
    dependencies: [FetchHttpClient.layer],
    effect: Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const httpClientOk = httpClient.pipe(
        HttpClient.filterStatusOk,
        HttpClient.mapRequest(
          HttpClientRequest.prependUrl("https://icanhazdadjoke.com")
        )
      );

      const search = Effect.fn("ICanHazDadJoke.search")(function* (
        searchTerm: string
      ) {
        return yield* httpClientOk
          .get("/search", {
            acceptJson: true,
            urlParams: { term: searchTerm },
          })
          .pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(SearchResponse)),
            Effect.flatMap(({ results }) => Array.head(results)),
            Effect.map((joke) => joke.joke),
            Effect.orDie
          );
      });

      return {
        search,
      } as const;
    }),
  }
) {}

const DadJokeToolHandlers = DadJokeTools.toLayer(
  Effect.gen(function* () {
    const icanhazdadjoke = yield* ICanHazDadJoke;
    return {
      GetDadJoke: ({ searchTerm }) => icanhazdadjoke.search(searchTerm),
    };
  })
).pipe(Layer.provide(ICanHazDadJoke.Default));

const program = Effect.gen(function* () {
  const response = yield* LanguageModel.generateText({
    prompt:
      "Use the GetDadJoke tool to find a dad joke about scientists, then tell me the joke",
    toolkit: DadJokeTools,
  });

  // If the response text is empty, extract from tool results
  const jokeText =
    response.text ||
    pipe(
      Array.head(response.toolResults),
      Option.map((tr) => String(tr.result)),
      Option.getOrElse(() => "No joke found")
    );

  console.log(jokeText);
}).pipe(Effect.provide(OpenAiLanguageModel.model("gpt-5-mini")));

const OpenAI = OpenAiClient.layerConfig({
  apiKey: Config.redacted("OPENAI_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

program.pipe(Effect.provide([OpenAI, DadJokeToolHandlers]), BunRuntime.runMain);
