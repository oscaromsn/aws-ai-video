import { LanguageModel } from "@effect/ai";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { FetchHttpClient } from "@effect/platform";
import { BunRuntime } from "@effect/platform-bun";
import { Config, Console, Effect, Layer } from "effect";

const dadJoke = Effect.gen(function* () {
  const response = yield* LanguageModel.generateText({
    prompt: "Tell me a really groan-inducing dad joke - don't hold back",
  });

  yield* Console.log(response.text);

  return response;
});

const Gpt5Mini = OpenAiLanguageModel.model("gpt-5-mini");

const program = Effect.provide(dadJoke, Gpt5Mini);

const OpenAI = OpenAiClient.layerConfig({
  apiKey: Config.redacted("OPENAI_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

program.pipe(Effect.provide(OpenAI), BunRuntime.runMain);
