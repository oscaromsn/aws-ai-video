# CLAUDE.md

This document provides a unified set of rules, patterns, and best practices for developing high-quality, idiomatic, and production-ready applications using the Effect-TS framework. Adherence to these guidelines is mandatory.

## 🚨 HIGHEST PRIORITY RULES 🚨

These rules are non-negotiable and must be followed in all circumstances to prevent critical bugs and maintain the integrity of the Effect runtime.

### 1. ABSOLUTELY FORBIDDEN: `try-catch` in `Effect.gen`

**NEVER use `try-catch` blocks inside `Effect.gen` generators.**

- **Rationale:** Effect generators handle errors through the Effect type system, not JavaScript exceptions. Using `try-catch` bypasses Effect's typed error channel, breaks interruption safety, and leads to unpredictable behavior and defects.
- **CRITICAL:** This will cause runtime errors and break Effect's fundamental error handling and resource management guarantees.

- **❌ FORBIDDEN PATTERN:**

	```typescript
    Effect.gen(function* () {
      try {
        // ❌ WRONG - This will NEVER work as expected.
        const result = yield* someFallibleEffect;
      } catch (error) {
        // ❌ This block will NOT be reached for Effect failures.
      }
    });
    ```

- **✅ CORRECT PATTERNS (Handling Errors as Values):**

	```typescript
    import { Effect, Either, Exit } from "effect";

    // A) Using Effect.either to handle failures within the generator
    Effect.gen(function* () {
      const result = yield* Effect.either(someFallibleEffect);
      if (Either.isLeft(result)) {
        // Handle the error `result.left` here
        return "fallback-value";
      }
      return result.right; // Continue with success value
    });

    // B) Using Effect.exit for more granular failure analysis
    Effect.gen(function* () {
      const exit = yield* Effect.exit(someFallibleEffect);
      if (Exit.isFailure(exit)) {
        // Handle the full Cause of failure
      }
    });

    // C) Pipe error handling combinators after the generator
    Effect.gen(function* () {
      // Write the "happy path" logic
      return yield* someEffectThatCanFail();
    }).pipe(
      Effect.catchTag("SpecificError", (error) => Effect.log("Handled specific error"))
    );
    ```

### 2. ABSOLUTELY FORBIDDEN: Unsafe Type Assertions

**NEVER EVER use `as any`, `as unknown`, or `as never` type assertions.**

- **Rationale:** These assertions destroy TypeScript's type safety, hide underlying type errors, and create a false sense of security. They are a primary source of runtime bugs.
- **CRITICAL:** The solution is always to fix the root type mismatch, not to mask it.

- **❌ FORBIDDEN PATTERNS:**

	```typescript
    const value = something as any;      // ❌ Hides all type information.
    const value = something as unknown;  // ❌ Defeats specific typing.
    const value = something as never;    // ❌ Usually a hack to bypass checks.
    ```

- **✅ CORRECT APPROACH (Fix the type issue):**
	- Use proper generic type parameters.
	- Import the correct types.
	- Use Effect constructors and combinators that produce the desired type.
	- Adjust function signatures to match their usage.
	- Use `Schema.decodeUnknown` for safely parsing `unknown` data.

### 3. MANDATORY: `return yield*` for Terminal Effects in `Effect.gen`

**ALWAYS use `return yield*` when yielding terminal effects like `Effect.fail`, `Effect.die`, or `Effect.interrupt`.**

- **Rationale:** This explicitly signals to both the TypeScript compiler and human readers that the generator's execution path terminates at that point. This is crucial for correct type-narrowing and control flow analysis. Omitting `return` can lead to unreachable code and incorrect type inference.

- **✅ MANDATORY PATTERN:**

	```typescript
    import { Effect } from "effect";

    Effect.gen(function* () {
      if (someErrorCondition) {
        // ✅ CORRECT: Makes termination explicit.
        return yield* Effect.fail(new SpecificError());
      }
      if (someFatalCondition) {
        // ✅ CORRECT: Clearly indicates a defect path.
        return yield* Effect.die(new Error("Unrecoverable state"));
      }
      const result = yield* someOtherEffect;
      return result;
    });
    ```

- **❌ WRONG PATTERN:**

	```typescript
    Effect.gen(function* () {
      if (someErrorCondition) {
        // ❌ WRONG: Missing `return`. Code below is incorrectly considered reachable.
        yield* Effect.fail(new SpecificError());
      }
      // This line is incorrectly typed as reachable by the compiler.
      const result = yield* someOtherEffect;
    });
    ```

---

## Core Philosophy & Mental Models

- **Effect is a Language:** Treat Effect not as a library, but as a domain-specific language embedded in TypeScript for describing effectful computations.
- **Effects are Blueprints:** An `Effect` is an immutable, lazy *description* of a program. It is a blueprint, not the running program itself. Nothing happens until it is executed by a `Runtime`.
- **Holistic Thinking:** Your code must account for success, all expected errors, and all dependencies. The `Effect<A, E, R>` type is your guide.
- **Separate "What" from "How":** Business logic (the "what") should be defined separately from its execution and error handling strategies (the "how"). This is achieved through composition.
- **Make Impossible States Unrepresentable:** Use the type system (`A`, `E`, `R`), `Schema`, and branded types to ensure that invalid states cannot be created at compile time.
- **Composition over Inheritance:** Build complex functionality by composing small, independent effects and layers.

---

## Development Workflow & Methodology

This project follows an **Interface-First, Contract-Driven Test-Driven Development (TDD)** methodology.

### The Incremental TDD Cycle ("Define Contract, Test Contract, Fulfill Contract Cycle")

Each feature should be developed in small, verifiable increments.

#### Phase 1: Define the Domain Contracts (The "What")

1. **Errors First:** In `domain/errors.ts`, define all possible failure modes for the feature as `Data.TaggedError` classes. This is part of the design.
2. **Models Second:** In `domain/models.ts`, define data structures using `@effect/schema`.
3. **Service Interface:** In `services/MyService.interface.ts`, define or update the service interface (`class MyService extends Effect.Service(...)`) to include the new functionality. The method signature MUST include the new error types in its error channel (`E`).

#### Phase 2: Test the Contract (Red Phase)

- Write tests against the *interface* in `services/MyService.test.ts`. These tests should be completely decoupled from any production implementation.
- Use a live, in-memory **test double** (a `Layer` that implements the interface using `Ref` or `Map`) to test the contract.
- Write tests for both the happy path and all specified error paths. Failure tests MUST use `Effect.exit`.
- **Confirm that these tests fail**, as the production implementation does not yet exist.

#### Phase 3: Implement the Contract (Green Phase)

- In `services/MyService.impl.ts`, write the minimal production `Layer` (`MyServiceLive`) to make the contract tests pass.
- Implement the business logic required to make the tests from Phase 2 pass.
- Run tests continuously using `bunx vitest`. Stop when all tests are green.

#### Phase 4: Refactor with Confidence

- With a full suite of passing contract tests, refactor the implementation for clarity, performance, and maintainability. The tests act as a safety net.

### Mandatory Validation Steps

- **After EVERY file edit:** Run the linter and type-checker. `bun run typecheck && bun run check`.
- **Before EVERY commit:** Run the full verification script, including tests for changed files.
- **NEVER** proceed to the next development step until all checks pass.

---

## Core Implementation Patterns

### 1. Creating and Composing Effects

#### Constructors

Use the appropriate constructor based on the source of the effect:

| Source      | Infallible         | Fallible            |
| :---------- | :----------------- | :------------------ |
| **Value**   | `Effect.succeed`   | `Effect.fail`       |
| **Sync Fn** | `Effect.sync`      | `Effect.try`        |
| **Promise** | `Effect.promise`   | `Effect.tryPromise` |

#### Composition Styles

- **`Effect.gen`:** MANDATORY for primary business logic, sequential operations with intermediate state, multi-step workflows, and complex control flow (conditionals/loops). It offers an imperative style with functional guarantees.
- **`.pipe()`:** Use for post-processing effects created by `Effect.gen`. This includes error handling, adding observability (tracing/logging), providing layers, and simple, single-step transformations.

**✅ Hybrid Pattern (Best Practice):**

```typescript
import { Effect, Layer, Data } from "effect";

// Business logic is clear and sequential inside `gen`.
function coreLogic(input: string): Effect.Effect<string, MyError> {
  return Effect.gen(function* () {
    const intermediate = yield* step1(input);
    const result = yield* step2(intermediate);
    return result;
  });
}

// Cross-cutting concerns are composed cleanly using `pipe`.
const productionReadyLogic = (input: string) => coreLogic(input).pipe(
  Effect.catchTag("MyError", () => Effect.succeed("default")),
  Effect.withSpan("coreLogic.production"),
  Effect.provide(MyService.Default)
);
```

### 2. Error Handling

- **Define Errors:** All domain errors MUST be defined as classes extending `Data.TaggedError`. For errors crossing API boundaries, use `Schema.TaggedError`.

	```typescript
    import { Data } from "effect";
    export class UserNotFoundError extends Data.TaggedError("UserNotFoundError")<{ userId: string }> {}
    ```

- **Handle Errors Explicitly:** Use `Effect.catchTag`, `Effect.catchTags`, or `Effect.catchIf` for predictable failures. Avoid `Effect.catchAll` unless at the absolute edge of your application.

- **Failures vs. Defects:**
	- **Failures (Errors):** Use `Effect.fail` for expected, recoverable errors. These are part of your business logic.
	- **Defects (Bugs):** Use `Effect.die` for unrecoverable errors or contract violations (e.g., API response fails schema validation, `ParseError` from a trusted internal source). This signifies a programming error and bypasses normal error handling.

### 3. Data Modeling with `@effect/schema`

- **MANDATORY:** All data crossing application boundaries (APIs, databases, queues) MUST be defined with `@effect/schema`.
- **Bidirectional:** A single schema defines validation, parsing, serialization, and type generation. Use it as the single source of truth for data structures.
- **Domain Models:** Use `Schema.Class` for domain entities to get an opaque type, methods, and automatic `Equal`/`Hash` implementations. Use `Schema.Struct` for simple data transfer objects.
- **Validation:** Use `Schema.decodeUnknown` at application boundaries (e.g., HTTP request bodies) to safely parse `unknown` input.
- **Transformations:** Use `Schema.transformOrFail` for fallible data transformations (e.g., parsing a JSON string) and `Schema.filter` for adding validation rules.
- **Secrets:** Use `Schema.Redacted` for sensitive fields like passwords or API keys to prevent them from being logged.

### 4. Dependency Injection with Services and Layers

- **Service Definition:** Use the modern `Effect.Service` class-based pattern to define services. It bundles the tag, interface, and default layer into one ergonomic unit.
- **`Layer`:** Layers are composable, memoized constructors for services. Use them to build your application's dependency graph.
- **Layer Composition:** Compose layers using `Layer.provide`, `Layer.merge`, and `Layer.provideMerge`.
- **Local Dependency Erasure:** Provide dependencies to a layer within its own file to create a self-contained unit. This simplifies the final application assembly.
- **Single `Effect.provide`:** MANDATORY Rule - Compose all application layers into a single `MainLayer`, then provide it **once** at the application's entry point using `Effect.provide`. Multiple `Effect.provide` calls break memoization and create separate scopes.
- **Resourceful Services:** Services that manage resources (e.g., database connections) MUST be defined using `Layer.scoped` or `Effect.acquireRelease` to guarantee cleanup.

**✅ Service and Layer Pattern:**

```typescript
// src/services/EmailService.ts
import { Effect, Layer, Data } from "effect";

// 1. Define errors and models first
export class SendError extends Data.TaggedError("SendError") {}
// The public contract is implicitly defined by the service's return type.

// 2. Define the service with the modern Effect.Service pattern
export class EmailService extends Effect.Service<EmailService>()("app/EmailService", {
  // Specify dependencies needed for construction
  dependencies: [SmtpClient.Default],
  // Use `scoped` for services managing resources
  scoped: Effect.gen(function* () {
    // 3. Dependencies are acquired HERE, during layer construction.
    const smtp = yield* SmtpClient;

    // 4. Return the service's public interface (the contract).
    // Methods assume dependencies are already available from the closure.
    return {
      send: (to: string, body: string): Effect.Effect<void, SendError> =>
        smtp.send({ to, body })
    };
  })
}) {}

// src/main.ts
// 5. Compose and provide the default layer at the application's edge
const MainLayer = Layer.mergeAll(EmailService.Default, Database.Default, /* ... */);
const runnable = myAppLogic.pipe(Effect.provide(MainLayer));
Effect.runPromise(runnable);
```

### 5. Concurrency & State Management

- **Structured Concurrency:** Use high-level APIs like `Effect.all`, `Effect.forEach`, and `Effect.race` with the `{ concurrency: ... }` option. Let Effect manage fiber lifecycles. Avoid manual fiber management with `Effect.fork` unless building low-level abstractions.
- **Concurrency Primitives:** Use the right tool for the job:
	- **`Semaphore`:** To limit concurrent access to a resource (a mutex if permits = 1).
	- **`Latch`:** To pause/gate a group of fibers until a one-time event occurs. Always use `Effect.ensuring(latch.open)` to prevent deadlocks.
	- **`Queue`:** For producer-consumer patterns and distributing work.
	- **`Deferred`:** For one-to-one, one-time communication between two fibers.
	- **`Ref`:** For simple, fiber-safe mutable state.
	- **`SubscriptionRef`:** For reactive state that multiple consumers can subscribe to via its `.changes` stream.
- **Structured Concurrency:** Rely on Effect's automatic parent-child fiber lifecycle management. Use `Effect.forkDaemon` only when you explicitly need a fiber to outlive its parent, and manage its lifecycle carefully.

### 6. Resource Management

- **MANDATORY:** Any resource requiring explicit cleanup MUST be managed within a `Scope`.
- **`Effect.acquireRelease`:** The primary pattern for acquiring and releasing resources. The `release` finalizer is **guaranteed** to run, even on interruption.
- **`Layer.scoped`:** The pattern for creating services that are themselves resources (e.g., a database connection pool).
- **`Effect.ensuring`:** The idiomatic equivalent of a `finally` block that is safe against interruption.
- **Never use manual resource cleanup (`try/finally`):** Not safe against interruption. Use `Effect.ensuring` or `Scope`.

---

## Testing

Effect provides a powerful, integrated testing toolkit.

IMPORTANT: Run tests using `bunx vitest` directly, do **NOT** run tests using `bun test`.

- **Framework:** Use `@effect/vitest` and its `it.effect` (or `it.scoped`) test runner for all Effect-based tests. It automatically handles running the effect.
- **Assertions:** Use `assert` from `@effect/vitest`, not `expect` from `vitest`.
- **Test Doubles (Fakes > Mocks):** The idiomatic approach is to create fully-functional, in-memory `Layer` implementations of your service interfaces. These are "fakes" and are superior to method-level mocks. **Do not use traditional mocking libraries like `vi.mock`**.
- **Testing Failures:** ALWAYS use `Effect.exit` to wrap expected failures and assert on the `Exit` value:

	```typescript
    it.effect("should fail correctly", () => Effect.gen(function* () {
      const exit = yield* Effect.exit(fallibleOperation());
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Cause.failureOption(exit.cause);
        assert.deepStrictEqual(Option.getOrThrow(error), new ExpectedError());
      }
    }));
    ```

- **Time-Dependent Testing:** Provide the `TestContext.TestContext` layer to your test effect. This gives you access to `TestClock`, which allows you to deterministically `adjust` and `setTime` to test timeouts and schedules instantly.
- **Interaction Testing (Shadow Services):** To verify that a method was called (e.g., an email was sent), use the "Shadow Service" pattern. Create a test-specific service that extends the production interface with assertion methods (`wasEmailSentTo(...)`) and provide a shared instance for both the production and test tags. This is a type-safe alternative to traditional mocking libraries.

---

## Application Architecture Blueprints

### HTTP API (`@effect/platform`)

1. **Contract-First:** Define your API using `HttpApi`, `HttpApiGroup`, and `HttpApiEndpoint`. Use `Schema` for all payloads, responses, and typed errors with HTTP status annotations.
2. **Server Implementation:** Use `HttpApiBuilder` to implement handlers. The compiler will enforce that your implementation matches the contract.
3. **Client Generation:** Use `HttpApiClient.make` to create a fully type-safe client from the same contract.
4. **Full-Stack Safety:** Use the same `Schema` definitions for client-side form validation to achieve true end-to-end runtime safety.

### CLI (`@effect/cli`)

- Define commands, arguments, and options declaratively.
- Effect `Schema` is used to validate and parse inputs automatically.
- The handler for a command is an `Effect`, allowing you to use your application's services directly.

### React Integration (`ManagedRuntime`)

- **Bridge:** Use `ManagedRuntime.make(MyLayer)` to create a runtime from your application's layers. This runtime can be stored in React Context.
- **Execution:** Use custom hooks (e.g., `useEffectfulQuery`) that use the runtime's `runPromise` or `runFork` methods to execute effects.
- **Lifecycle:** Ensure the runtime is disposed of when the component unmounts to trigger resource cleanup. `useEffect(() => () => runtime.dispose(), [runtime])`.

---

## Naming Conventions

| Artifact                  | Convention                       | Example                                                  |
| :------------------------ | :------------------------------- | :------------------------------------------------------- |
| **Service Definition**    | PascalCase                       | `class UserService extends Effect.Service(...)`          |
| **Live Layer**            | PascalCase, `Live` suffix        | `const UserServiceLive = Layer.effect(...)`              |
| **Test/Mock Layer**       | PascalCase, `Test`/`Mock` suffix | `const UserServiceTest = Layer.succeed(...)`             |
| **Error Type**            | PascalCase, `Error` suffix       | `class UserNotFoundError extends Data.TaggedError(...)`  |
| **Schema**                | PascalCase, `Schema` suffix      | `const UserSchema = Schema.Struct(...)`                  |
| **Branded Type**          | PascalCase                       | `type UserId = string & Brand.Brand<"UserId">`           |

---

## Anti-Patterns & Code Smells

- **Multiple `Effect.provide` Calls:** Breaks layer memoization and creates multiple scopes. Compose layers first, then provide once.
- **`Effect.run*` inside other effects:** Breaks composition and all of Effect's guarantees. Only run effects at the application edge.
- **Ignoring Defects:** `ParseError` from schema validation or a timeout after retries often indicates a defect. Use `Effect.die` to escalate these. Do not use `Effect.catchAll` indiscriminately - let defects crash the fiber; handle them at the highest level for logging and process restart.
- **Manual Fiber Management:** Avoid `Effect.fork` unless you are building a low-level abstraction. Prefer `Effect.all` and other high-level concurrency operators.
- **Manual Resource Cleanup (`try/finally`):** Not safe against interruption. Use `Effect.ensuring` or `Scope`.
- **Transparent Middleware for Core Logic:** Don't hide critical logic like token refreshing inside a "magic" `HttpClient`. Model it as an explicit `Session` service that the client depends on for clarity and testability.
- **Global State:** Do not use global mutable state. Encapsulate state within services and manage it with `Ref` or `SubscriptionRef`.
- **Leaking `Scope`:** A `Scope` in the `R` channel of a public-facing service method is usually a design smell. Resource management should be an implementation detail of the service's `Layer`.

---

Remember, your goal is write idiomatic, concise and performant Effect code focused in correctness, maintainability and testability.
