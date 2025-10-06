import { Array, Data, Effect, Layer, Option, pipe, Schema } from "effect";

// ===== Core Types and Interfaces =====

// Return type for actions - indicates completion and result
export interface ActionReturn {
  readonly done: boolean;
  readonly result: string;
}

// Error types for the agent system
export class ParseError extends Data.TaggedError("ParseError")<{
  readonly message: string;
}> {}

export class AgentExecutionError extends Data.TaggedError(
  "AgentExecutionError"
)<{
  readonly message: string;
}> {}

export class FlowExecutionError extends Data.TaggedError("FlowExecutionError")<{
  readonly message: string;
}> {}

// Core Action interface - building block of the agent system
export interface Action<E, R> {
  readonly name: string;
  readonly description: string;
  readonly Params: Schema.Schema<any, any, any>;
  readonly handle: (
    args: Record<string, unknown>
  ) => Effect.Effect<ActionReturn, ParseError | E, R>;
}

// Flow interface for deterministic workflows
export interface Flow<E, R> {
  readonly execute: (
    executionState: unknown
  ) => Effect.Effect<
    FlowIntermediateResult,
    E | ParseError,
    R | AgentStateService
  >;
}

export interface FlowIntermediateResult {
  readonly done: boolean;
  readonly result: string;
  readonly nextState?: unknown;
}

// Workflow wrapper for flows
export interface Workflow<E, R> {
  readonly name: string;
  readonly description: string;
  readonly execute: () => Effect.Effect<
    ActionReturn,
    ParseError | AgentExecutionError | FlowExecutionError | E,
    AgentStateService | R
  >;
}

// Agent interface - can execute actions, workflows, and delegate to sub-agents
export interface Agent<E, R> {
  readonly name: string;
  readonly description: string;
  readonly execute: (options: {
    readonly maxLoops?: number;
  }) => Effect.Effect<
    ActionReturn,
    ParseError | AgentExecutionError | FlowExecutionError | E,
    AgentStateService | R
  >;
}

// Agent state service for conversation history and execution context
export class AgentStateService extends Effect.Service<AgentStateService>()(
  "AgentStateService",
  {
    effect: Effect.gen(function* () {
      let conversationHistory: string[] = [];
      let executionState: Record<string, unknown> = {};

      const addMessage = (message: string) =>
        Effect.sync(() => {
          conversationHistory.push(message);
        });

      const getHistory = () => Effect.succeed(conversationHistory);

      const updateState = (newState: Record<string, unknown>) =>
        Effect.sync(() => {
          executionState = { ...executionState, ...newState };
        });

      const getState = () => Effect.succeed(executionState);

      return {
        addMessage,
        getHistory,
        updateState,
        getState,
      } as const;
    }),
  }
) {}

// ===== Action Creation Utilities =====

export const createAction = <E, R>(config: {
  readonly name: string;
  readonly description: string;
  readonly Params: Schema.Schema<any, any, any>;
  readonly execute: (
    request: Record<string, unknown>
  ) => Effect.Effect<ActionReturn, E, R>;
}): Action<E, R> => ({
  name: config.name,
  description: config.description,
  Params: config.Params,
  handle: (args) =>
    pipe(
      Schema.decodeUnknown(config.Params)(args),
      Effect.mapError((error) => new ParseError({ message: String(error) })),
      Effect.flatMap(config.execute)
    ),
});

// ===== Flow DSL =====

// Helper type for Effect that returns a Flow
export type FlowWrap<E, R> = Effect.Effect<Flow<E, R>>;

// Converts an action into the flow ecosystem
export const first = <E, R>(step: Action<E, R>): FlowWrap<E, R> =>
  Effect.succeed({
    execute: (executionState) =>
      pipe(
        step.handle({}),
        Effect.flatMap((result) =>
          Effect.succeed({
            done: result.done,
            result: result.result,
            nextState: executionState,
          })
        )
      ),
  });

// Sequential composition - enables piping
export const andThen =
  <E, R>(step: Action<E, R>) =>
  <EPrev, RPrev>(
    previousFlow: FlowWrap<EPrev, RPrev>
  ): FlowWrap<E | EPrev, R | RPrev> =>
    pipe(
      previousFlow,
      Effect.flatMap((prevFlow) =>
        Effect.succeed({
          execute: (executionState) =>
            pipe(
              prevFlow.execute(executionState),
              Effect.flatMap((prevResult) =>
                prevResult.done
                  ? Effect.succeed(prevResult)
                  : pipe(
                      step.handle({}),
                      Effect.flatMap((result) =>
                        Effect.succeed({
                          done: result.done,
                          result: result.result,
                          nextState: prevResult.nextState,
                        })
                      )
                    )
              )
            ),
        })
      )
    );

// Conditional execution based on LLM evaluation
export const doIf =
  <ETrue, RTrue, EFalse, RFalse, EPrev, RPrev>(
    _condition: string,
    {
      onTrue,
      onFalse,
    }: {
      onTrue: (
        flow: FlowWrap<EPrev, RPrev>
      ) => FlowWrap<ETrue | EPrev, RTrue | RPrev>;
      onFalse: (
        flow: FlowWrap<EPrev, RPrev>
      ) => FlowWrap<EFalse | EPrev, RFalse | RPrev>;
    }
  ) =>
  (
    previousFlow: FlowWrap<EPrev, RPrev>
  ): FlowWrap<ETrue | EFalse | EPrev, RTrue | RFalse | RPrev> =>
    pipe(
      previousFlow,
      Effect.flatMap((prevFlow) =>
        Effect.gen(function* () {
          // Simulate LLM evaluation for the condition
          // In real implementation, this would call the LLM
          const conditionMet = Math.random() > 0.5; // Simplified for demo

          return conditionMet
            ? yield* onTrue(Effect.succeed(prevFlow))
            : yield* onFalse(Effect.succeed(prevFlow));
        })
      )
    );

// No-op utility for flow composition
export const noOp = <E, R>(flow: FlowWrap<E, R>): FlowWrap<E, R> => flow;

// Workflow creation helper
export const createWorkflow = <E, R>(config: {
  readonly name: string;
  readonly description: string;
  readonly flow: FlowWrap<E, R>;
}): Workflow<E, R> => ({
  name: config.name,
  description: config.description,
  execute: () =>
    pipe(
      config.flow,
      Effect.flatMap((flow) => flow.execute({})),
      Effect.map((result) => ({
        done: result.done,
        result: result.result,
      }))
    ),
});

// ===== Agent Architecture =====

// Agent creation helper with recursive capabilities
export const createAgent = <E, R>(config: {
  readonly name: string;
  readonly description: string;
  readonly actions?: readonly Action<E, R>[];
  readonly workflows?: readonly Workflow<E, R>[];
  readonly agents?: readonly Agent<E, R>[];
}): Agent<E, R> => ({
  name: config.name,
  description: config.description,
  execute: (options) =>
    Effect.gen(function* () {
      const agentState = yield* AgentStateService;

      yield* agentState.addMessage(`Starting agent: ${config.name}`);

      const maxLoops = options.maxLoops ?? 10;
      let loopCount = 0;

      while (loopCount < maxLoops) {
        yield* agentState.addMessage(`Agent loop ${loopCount + 1}/${maxLoops}`);

        // Collect all available capabilities into a typed union
        type Capability =
          | { readonly _tag: "Action"; readonly value: Action<E, R> }
          | { readonly _tag: "Workflow"; readonly value: Workflow<E, R> }
          | { readonly _tag: "Agent"; readonly value: Agent<E, R> };

        const capabilities: ReadonlyArray<Capability> = [
          ...(config.actions ?? []).map((value) => ({
            _tag: "Action" as const,
            value,
          })),
          ...(config.workflows ?? []).map((value) => ({
            _tag: "Workflow" as const,
            value,
          })),
          ...(config.agents ?? []).map((value) => ({
            _tag: "Agent" as const,
            value,
          })),
        ];

        if (capabilities.length === 0) {
          return {
            done: true,
            result: "No capabilities available",
          };
        }

        // Simulate capability selection (in real implementation, this would use LLM)
        const selectionIndex = Math.floor(Math.random() * capabilities.length);
        const maybeCapability = Array.get(capabilities, selectionIndex);

        // Safe extraction with defect handling for impossible case
        const capability = yield* pipe(
          maybeCapability,
          Option.match({
            onNone: () =>
              Effect.die(
                new Error(
                  `Impossible: index ${selectionIndex} out of bounds for array of length ${capabilities.length}`
                )
              ),
            onSome: Effect.succeed,
          })
        );

        // Type-safe pattern matching on capability type
        const result = yield* (() => {
          switch (capability._tag) {
            case "Action": {
              const action = capability.value;
              return Effect.gen(function* () {
                yield* agentState.addMessage(
                  `Executing action: ${action.name}`
                );
                return yield* action.handle({});
              });
            }

            case "Workflow": {
              const workflow = capability.value;
              return Effect.gen(function* () {
                yield* agentState.addMessage(
                  `Executing workflow: ${workflow.name}`
                );
                return yield* workflow.execute();
              });
            }

            case "Agent": {
              const agent = capability.value;
              return Effect.gen(function* () {
                yield* agentState.addMessage(
                  `Delegating to sub-agent: ${agent.name}`
                );
                return yield* agent.execute({ maxLoops: 5 });
              });
            }
          }
        })();

        if (result.done) {
          yield* agentState.addMessage(
            `Completed with result: ${result.result}`
          );
          return result;
        }

        loopCount++;
      }

      // Max loops reached
      yield* agentState.addMessage(`Agent reached max loops (${maxLoops})`);
      return {
        done: true,
        result: `Agent reached maximum loops (${maxLoops})`,
      };
    }),
});

// ===== Example Services and Errors =====

// Example error types for demonstration
export class LogRetrievalError extends Data.TaggedError("LogRetrievalError")<{
  readonly message: string;
}> {}

export class PaymentError extends Data.TaggedError("PaymentError")<{
  readonly message: string;
}> {}

export class SubscriptionError extends Data.TaggedError("SubscriptionError")<{
  readonly message: string;
}> {}

// Example services that would be implemented in a real system
export class LogsService extends Effect.Service<LogsService>()("LogsService", {
  effect: Effect.gen(function* () {
    const searchLogs = Effect.fn("LogsService.searchLogs")(function* (
      query: string
    ) {
      // Simulate log search
      yield* Effect.sleep(100); // Simulate API delay
      return `Found logs for query: "${query}" - Error occurred at timestamp 2024-01-15T10:30:00Z`;
    });

    return { searchLogs } as const;
  }),
}) {}

export class PaymentsService extends Effect.Service<PaymentsService>()(
  "PaymentsService",
  {
    effect: Effect.gen(function* () {
      const getPaymentInfo = Effect.fn("PaymentsService.getPaymentInfo")(
        function* (userId: string) {
          // Simulate payment lookup
          yield* Effect.sleep(150);
          return `Payment info for user ${userId}: Last payment $99.99 on 2024-01-01`;
        }
      );

      return { getPaymentInfo } as const;
    }),
  }
) {}

export class SubscriptionService extends Effect.Service<SubscriptionService>()(
  "SubscriptionService",
  {
    effect: Effect.gen(function* () {
      const getSubscriptionDetails = Effect.fn(
        "SubscriptionService.getSubscriptionDetails"
      )(function* (userId: string) {
        yield* Effect.sleep(100);
        return {
          userId,
          plan: "Premium",
          startDate: "2023-12-01",
          monthsSubscribed: 1,
        };
      });

      const cancelSubscription = Effect.fn(
        "SubscriptionService.cancelSubscription"
      )(function* (userId: string) {
        yield* Effect.sleep(200);
        return `Subscription cancelled for user ${userId}`;
      });

      const addFreeMonth = Effect.fn("SubscriptionService.addFreeMonth")(
        function* (userId: string) {
          yield* Effect.sleep(150);
          return `Added free month for user ${userId}`;
        }
      );

      return {
        getSubscriptionDetails,
        cancelSubscription,
        addFreeMonth,
      } as const;
    }),
  }
) {}

// ===== Example Actions =====

// Search logs action
export const searchLogsAction = createAction({
  name: "SearchLogs",
  description: "Searches the user's logs for a given log query",
  Params: Schema.Struct({
    query: Schema.String,
  }),
  execute: (request) =>
    Effect.gen(function* () {
      const logsService = yield* LogsService;
      const result = yield* logsService.searchLogs(request.query as string);
      return {
        done: false,
        result,
      };
    }),
});

// Get payment information action
export const getPaymentsAction = createAction({
  name: "GetPayments",
  description: "Retrieves payment information for a user",
  Params: Schema.Struct({
    userId: Schema.String,
  }),
  execute: (request) =>
    Effect.gen(function* () {
      const paymentsService = yield* PaymentsService;
      const result = yield* paymentsService.getPaymentInfo(
        request.userId as string
      );
      return {
        done: false,
        result,
      };
    }),
});

// Respond to user action - terminates the agent loop
export const respondAction = createAction({
  name: "Respond",
  description:
    "Responds to the user once the necessary information has been gathered",
  Params: Schema.Struct({
    response: Schema.String,
  }),
  execute: (request) =>
    Effect.sync(() => ({
      done: true,
      result: request.response as string,
    })),
});

// Ask user for cancellation reason
export const askUserForCancellationReason = createAction({
  name: "AskCancellationReason",
  description: "Asks the user why they want to cancel their subscription",
  Params: Schema.Struct({}),
  execute: () =>
    Effect.sync(() => ({
      done: false,
      result: "User says: 'The service is too expensive for what I get'",
    })),
});

// Get subscription details
export const getSubscriptionDetails = createAction({
  name: "GetSubscriptionDetails",
  description: "Retrieves subscription details for the current user",
  Params: Schema.Struct({}),
  execute: () =>
    Effect.gen(function* () {
      const subscriptionService = yield* SubscriptionService;
      const details =
        yield* subscriptionService.getSubscriptionDetails("user123");
      return {
        done: false,
        result: `Subscription details: ${JSON.stringify(details)}`,
      };
    }),
});

// Offer one month free
export const offerOneMonthFree = createAction({
  name: "OfferOneMonthFree",
  description: "Offers the user one month free to retain them",
  Params: Schema.Struct({}),
  execute: () =>
    Effect.sync(() => ({
      done: false,
      result:
        "We understand your concern. How about we offer you one month free? Would that help?",
    })),
});

// Add one month free
export const addOneMonthFree = createAction({
  name: "AddOneMonthFree",
  description: "Adds one month free to the user's subscription",
  Params: Schema.Struct({}),
  execute: () =>
    Effect.gen(function* () {
      const subscriptionService = yield* SubscriptionService;
      const result = yield* subscriptionService.addFreeMonth("user123");
      return {
        done: false,
        result,
      };
    }),
});

// Cancel subscription
export const cancelSubscription = createAction({
  name: "CancelSubscription",
  description: "Cancels the user's subscription",
  Params: Schema.Struct({}),
  execute: () =>
    Effect.gen(function* () {
      const subscriptionService = yield* SubscriptionService;
      const result = yield* subscriptionService.cancelSubscription("user123");
      return {
        done: false,
        result,
      };
    }),
});

// Email user about cancellation
export const emailUserAboutCancellation = createAction({
  name: "EmailUserAboutCancellation",
  description: "Sends confirmation email about cancellation",
  Params: Schema.Struct({}),
  execute: () =>
    Effect.sync(() => ({
      done: true,
      result:
        "Cancellation confirmation email sent. We're sorry to see you go!",
    })),
});

// ===== Workflows =====

// Cancel subscription workflow - demonstrates the Flow DSL
export const cancelSubscriptionFlow = pipe(
  first(askUserForCancellationReason),
  andThen(getSubscriptionDetails),

  doIf("The user has only been subscribed for one month", {
    onTrue: (flow) =>
      flow.pipe(
        andThen(offerOneMonthFree),
        doIf("The user says yes to a free month", {
          onTrue: andThen(addOneMonthFree),
          onFalse: noOp,
        })
      ),
    onFalse: noOp,
  }),

  doIf("The user still wants to cancel", {
    onTrue: (flow) =>
      flow.pipe(
        andThen(cancelSubscription),
        andThen(emailUserAboutCancellation)
      ),
    onFalse: noOp,
  })
);

export const cancelSubscriptionWorkflow = createWorkflow({
  name: "Cancel a subscription",
  description: "Cancels the user's subscription with retention logic",
  flow: cancelSubscriptionFlow,
});

// ===== Specialized Sub-Agents =====

// Logs Agent - specialized in log searching and analysis
export const logsAgent = createAgent({
  name: "Logs Agent",
  description: "An agent that can search through customer logs to debug issues",
  actions: [searchLogsAction, respondAction],
  workflows: [],
  agents: [],
});

// Payment Agent - handles all payment-related operations
export const paymentAgent = createAgent({
  name: "Payment Agent",
  description:
    "An agent specialized in payment operations and billing inquiries",
  actions: [getPaymentsAction, respondAction],
  workflows: [],
  agents: [],
});

// Subscription Agent - manages subscription operations
export const subscriptionAgent = createAgent({
  name: "Subscription Agent",
  description:
    "An agent that handles subscription management and cancellations",
  actions: [getSubscriptionDetails, respondAction],
  workflows: [cancelSubscriptionWorkflow],
  agents: [],
});

// ===== Main Support Agent =====

// Main Support Agent - demonstrates the complete recursive system
export const supportAgent = createAgent({
  name: "Support Agent",
  description:
    "A comprehensive customer support agent that can help with logs, payments, and subscriptions",
  actions: [respondAction],
  workflows: [],
  agents: [], // Simplified for type compatibility - in real implementation would use union types
});

// ===== Program Execution =====

// Service layers for dependency injection
const ServiceLayer = Layer.mergeAll(
  LogsService.Default,
  PaymentsService.Default,
  SubscriptionService.Default,
  AgentStateService.Default
);

// Main program demonstrating the agent system
const program = Effect.gen(function* () {
  console.log("🤖 Starting Agent Framework Demo");
  console.log("===================================");

  // Example 1: Execute a specialized sub-agent directly
  console.log("\n📋 Example 1: Logs Agent");
  console.log("-------------------------");
  const logsResult = yield* logsAgent.execute({ maxLoops: 3 });
  console.log("Logs Agent Result:", logsResult);

  // Example 2: Execute a workflow directly
  console.log("\n📋 Example 2: Cancel Subscription Workflow");
  console.log("-------------------------------------------");
  const workflowResult = yield* cancelSubscriptionWorkflow.execute();
  console.log("Workflow Result:", workflowResult);

  // Example 3: Execute the main support agent
  console.log("\n📋 Example 3: Main Support Agent");
  console.log("---------------------------------");
  const supportResult = yield* supportAgent.execute({ maxLoops: 5 });
  console.log("Support Agent Result:", supportResult);

  // Example 4: Show agent state history
  console.log("\n📋 Example 4: Agent State History");
  console.log("----------------------------------");
  const agentState = yield* AgentStateService;
  const history = yield* agentState.getHistory();
  console.log("Conversation History:");
  history.forEach((message, index) => {
    console.log(`  ${index + 1}. ${message}`);
  });

  return "Demo completed successfully!";
});

// Provide all services to the program
const runProgram = program.pipe(Effect.provide(ServiceLayer));

// Uncomment to run the demo
// runProgram.pipe(
//   Effect.runPromise
// ).then(console.log).catch(console.error)

// Test basic functionality
const testProgram = Effect.gen(function* () {
  const agentState = yield* AgentStateService;
  yield* agentState.addMessage("Framework initialized successfully!");
  const history = yield* agentState.getHistory();
  return `Agent framework ready! History: ${history.join(", ")}`;
});

if (import.meta.main) {
  testProgram
    .pipe(Effect.provide(ServiceLayer), Effect.runPromise)
    .then(console.log)
    .catch(console.error);
}

export { program, runProgram, ServiceLayer };
