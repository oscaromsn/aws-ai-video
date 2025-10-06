import { Chat, LanguageModel, Tool, Toolkit } from "@effect/ai";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform";
import { BunRuntime } from "@effect/platform-bun";
import { Array, Config, Console, Effect, Layer, Schema, String } from "effect";

const GetDadJokeTool = Tool.make("GetDadJoke", {
  description: "Get a hilarious dad joke from the ICanHazDadJoke API",
  success: Schema.String,
  failure: Schema.Never,
  parameters: {
    searchTerm: Schema.String.annotations({
      description: "The search term to use to find dad jokes",
    }),
  },
});

const DadJokeTools = Toolkit.make(GetDadJokeTool);

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
  const jokeResponse = yield* LanguageModel.generateText({
    prompt: "Generate a dad joke about pirates",
    toolkit: DadJokeTools,
  });

  yield* Console.log(
    "Generated joke response:",
    jokeResponse.text ||
      jokeResponse.toolResults.map((r) => r.result).join("\n")
  );

  const JokeAnalysis = Schema.Struct({
    joke: Schema.String.annotations({
      description: "The original dad joke that was submitted for analysis",
    }),
    type: Schema.Literal(
      "pun",
      "one-liner",
      "wordplay",
      "absurd",
      "other"
    ).annotations({
      description: "Primary comedic mechanism of the joke",
    }),
    audience: Schema.Literal("kids", "teens", "adults", "all").annotations({
      description: "Intended or most-appropriate audience",
    }),
    explanation: Schema.String.annotations({
      description: "A brief, clear explanation of how the joke works",
    }),
    funninessRating: Schema.Number.annotations({
      description:
        "How funny the joke is on a scale from 1 (not funny) to 10 (hilarious)",
    }),
  }).annotations({
    description: "Represents an analysis of a dad joke or pun",
  });

  const jokeText =
    jokeResponse.text ||
    jokeResponse.toolResults.map((r) => r.result as string).join("\n");

  const chat = yield* Chat.empty;
  const analysis = yield* chat.generateObject({
    prompt: String.stripMargin(
      `|You are a dad-joke analysis assistant. Provide an analysis of the following joke:
       |"${jokeText}"
       |
       |Respond **only** with a JSON object matching the specified JSON
       |structure. Do not emit any extra fields or commentary.`
    ),
    schema: JokeAnalysis,
  });

  yield* Console.log(analysis.value);
}).pipe(Effect.provide(OpenAiLanguageModel.model("gpt-5-mini")));

const OpenAI = OpenAiClient.layerConfig({
  apiKey: Config.redacted("OPENAI_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

program.pipe(Effect.provide([OpenAI, DadJokeToolHandlers]), BunRuntime.runMain);
