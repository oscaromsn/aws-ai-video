import { Chat, Tool, Toolkit } from "@effect/ai";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { Prompt } from "@effect/cli";
import { FetchHttpClient, FileSystem, Path } from "@effect/platform";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Config, Console, Effect, Layer, Schema, Stream } from "effect";

const ListToolInput = Schema.Struct({
  path: Schema.String.annotations({
    description: "The absolute path of the directory to list",
  }),
});

const ListToolOutput = Schema.Struct({
  files: Schema.Array(Schema.String),
  directories: Schema.Array(Schema.String),
});

const ListTool = Tool.make("List", {
  description: "List the contents of a directory",
})
  .setParameters(ListToolInput)
  .setSuccess(ListToolOutput);

const ReadToolInput = Schema.Struct({
  path: Schema.String.annotations({
    description: "The absolute path of the file to read",
  }),
});

const ReadToolOutput = Schema.Struct({
  content: Schema.String,
});

const ReadTool = Tool.make("Read", {
  description: "Read the contents of a file",
})
  .setParameters(ReadToolInput)
  .setSuccess(ReadToolOutput);

const EditToolInput = Schema.Struct({
  path: Schema.String.annotations({
    description: "The absolute path of the file to edit",
  }),
  old_string: Schema.String.annotations({
    description: "The string to search for and replace",
  }),
  new_string: Schema.String.annotations({
    description: "The string to replace the old string with",
  }),
});

const EditToolOutput = Schema.Struct({
  message: Schema.String,
});

const EditTool = Tool.make("Edit", {
  description: "Edit a file by replacing the first occurrence of a string",
})
  .setParameters(EditToolInput)
  .setSuccess(EditToolOutput);

const MyToolkit = Toolkit.make(ListTool, ReadTool, EditTool);

const DangerousToolkitLayer = MyToolkit.toLayer(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;

    return MyToolkit.of({
      List: ({ path }: { path: string }) =>
        Effect.gen(function* () {
          yield* Console.log(`List(${path})`);

          const entries = yield* fs.readDirectory(path);
          const files: Array<string> = [];
          const directories: Array<string> = [];

          for (const name of entries) {
            const fullPath = pathService.isAbsolute(name)
              ? name
              : pathService.join(path, name);
            const stat = yield* fs.stat(fullPath);
            if (stat.type === "File") {
              files.push(fullPath);
            } else if (stat.type === "Directory") {
              directories.push(fullPath);
            }
          }

          return { files: files.sort(), directories: directories.sort() };
        }).pipe(
          Effect.catchAll((_) => Effect.succeed({ files: [], directories: [] }))
        ),

      Read: ({ path }) =>
        Effect.gen(function* () {
          yield* Console.log(`Read(${path})`);
          const content = yield* fs.readFileString(path);
          return { content };
        }).pipe(
          Effect.catchAll((error) => Effect.succeed({ content: error.message }))
        ),

      Edit: ({
        new_string,
        old_string,
        path,
      }: {
        path: string;
        old_string: string;
        new_string: string;
      }) =>
        Effect.gen(function* () {
          yield* Console.log(`Edit(${path}, ${old_string}, ${new_string})`);

          const original = yield* fs.readFileString(path);
          const occurrenceIndex = original.indexOf(old_string);

          if (occurrenceIndex === -1) {
            return { message: "No occurrences found. No changes made." };
          }

          const updated = original.replace(old_string, new_string);
          yield* fs.writeFileString(path, updated);
          return { message: "Edit successful." };
        }).pipe(
          Effect.catchAll((error) => Effect.succeed({ message: error.message }))
        ),
    });
  })
).pipe(Layer.provide(BunContext.layer));

const main = Effect.gen(function* () {
  const chat = yield* Chat.fromPrompt([
    {
      role: "system",
      content: [
        "You are a helpful AI assistant.",
        `You live in my terminal at cwd ${process.cwd()}.`,
      ].join("\n"),
    },
  ]);
  while (true) {
    const input = yield* Prompt.text({ message: ">" });
    let turn = 1;
    yield* Console.log(`TURN: ${turn}`);
    // text + tool calls
    let response = yield* chat
      .streamText({
        prompt: input,
        toolkit: MyToolkit,
      })
      .pipe(
        Stream.tap((event) =>
          Effect.sync(() => {
            if (event.type === "text-delta") {
              process.stdout.write(event.delta);
            } else if (event.type === "finish") {
              process.stdout.write("\n");
            }
          })
        ),
        Stream.runFold(
          { text: "", toolCalls: [] as Array<any> },
          (acc, event) => {
            if (event.type === "text-delta") {
              return { ...acc, text: acc.text + event.delta };
            } else if (event.type === "tool-call") {
              return { ...acc, toolCalls: [...acc.toolCalls, event] };
            }
            return acc;
          }
        )
      );

    while (response.toolCalls.length > 0) {
      turn += 1;
      yield* Console.log(`TURN: ${turn}`);
      response = yield* chat
        .streamText({
          prompt: [],
          toolkit: MyToolkit,
        })
        .pipe(
          Stream.tap((event) =>
            Effect.sync(() => {
              if (event.type === "text-delta") {
                process.stdout.write(event.delta);
              } else if (event.type === "finish") {
                process.stdout.write("\n");
              }
            })
          ),
          Stream.runFold(
            { text: "", toolCalls: [] as Array<any> },
            (acc, event) => {
              if (event.type === "text-delta") {
                return { ...acc, text: acc.text + event.delta };
              } else if (event.type === "tool-call") {
                return { ...acc, toolCalls: [...acc.toolCalls, event] };
              }
              return acc;
            }
          )
        );
    }
  }
});

const OpenAILayer = OpenAiClient.layerConfig({
  apiKey: Config.redacted("OPENAI_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

const ClaudeLayer = OpenAiLanguageModel.model("gpt-5-mini") //
  .pipe(Layer.provide(OpenAILayer));

const AppLayer = Layer.mergeAll(
  BunContext.layer,
  ClaudeLayer,
  DangerousToolkitLayer
);

main.pipe(Effect.provide(AppLayer), BunRuntime.runMain);
