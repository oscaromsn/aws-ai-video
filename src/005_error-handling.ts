import { LanguageModel } from "@effect/ai";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { FetchHttpClient } from "@effect/platform";
import { BunRuntime } from "@effect/platform-bun";
import { Config, Console, Effect, ExecutionPlan, Layer, Schema } from "effect";

const Pun = Schema.Struct({
  setup: Schema.String.annotations({
    description:
      "The opening line or premise of the joke—the “hook” that sets up the situation",
  }),
  punchline: Schema.String.annotations({
    description:
      "The payoff or twist that delivers the humor—typically follows the setup and completes the joke",
  }),
  explanation: Schema.String.annotations({
    description:
      "A brief note unpacking the wordplay or logic behind the joke—helps clarify puns or non-obvious twists",
  }),
}).annotations({ description: "An object representing a pun or dad joke" });

const dadJoke = Effect.gen(function* () {
  const response = yield* LanguageModel.generateObject({
    prompt: "Tell me a really groan-inducing dad joke - don't hold back",
    schema: Pun,
  });

  yield* Console.log(response.value);

  return response;
});

const Gpt5Mini = OpenAiLanguageModel.model("gpt-5-mini");
const Gpt5 = OpenAiLanguageModel.model("gpt-5");
const Plan = ExecutionPlan.make(
  {
    provide: Gpt5Mini,
    attempts: 2,
  },
  {
    provide: Gpt5,
    attempts: 2,
  }
);

const program = Effect.withExecutionPlan(dadJoke, Plan);

const OpenAI = OpenAiClient.layerConfig({
  apiKey: Config.redacted("OPENAI_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

program.pipe(Effect.provide(OpenAI), BunRuntime.runMain);
