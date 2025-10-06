import { Chat, LanguageModel } from "@effect/ai";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { FetchHttpClient } from "@effect/platform";
import { BunRuntime } from "@effect/platform-bun";
import { Config, Effect, Layer, Stream } from "effect";

const streamingExample = Effect.gen(function* () {
  console.log("🤖 LanguageModel streaming:");

  yield* LanguageModel.streamText({
    prompt: "Tell me a really groan-inducing dad joke - don't hold back",
  }).pipe(
    Stream.runForEach((response) =>
      Effect.sync(() => {
        // Only output text deltas (the actual content)
        if (response.type === "text-delta") {
          process.stdout.write(response.delta);
        } else if (response.type === "finish") {
          process.stdout.write("\n\n");
        }
      })
    )
  );

  console.log("💬 Chat streaming:");

  const chat = yield* Chat.empty;
  yield* chat
    .streamText({
      prompt: "Tell me another dad joke, but make it about programming",
    })
    .pipe(
      Stream.runForEach((response) =>
        Effect.sync(() => {
          if (response.type === "text-delta") {
            process.stdout.write(response.delta);
          } else if (response.type === "finish") {
            process.stdout.write("\n");
          }
        })
      )
    );
});

const Gpt5Mini = OpenAiLanguageModel.model("gpt-5-mini");

const program = Effect.provide(streamingExample, Gpt5Mini);

const OpenAI = OpenAiClient.layerConfig({
  apiKey: Config.redacted("OPENAI_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

program.pipe(Effect.provide(OpenAI), BunRuntime.runMain);
