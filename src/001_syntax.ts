import { Console, Effect, Random, Schedule } from "effect"

// Generators allow for programming imperatively with Effect.
//
// Most useful for writing your application's business logic.
//
// If you're familiar with async / await in JS, you can mentally map:
//   - function*() -> async
//   - yield* -> await
const program = Effect.gen(function* () {
  const result = yield* Random.nextIntBetween(0, 100)
  if (result > 50) {
    return yield* Effect.fail("Number too big!")
  }
  return result
})

// Pipelines allow for composing Effect programs together.
//
// Most useful for adding behavior to an Effect program.
//
// Conceptually, a pipeline is equivalent to applying a list 
// of functions to an input.
import { pipe } from "effect"

const addOne = (n: number): number => n + 1
const subtractOne = (n: number): number => n - 1
const multiplyByTen = (n: number): number => n * 10

addOne(subtractOne(multiplyByTen(42)))
// Output: 420

pipe(42, multiplyByTen, subtractOne, addOne)
// Output: 420

program.pipe(
  Effect.andThen((n) => Console.log(n)),
  Effect.retry({
    times: 10,
    schedule: Schedule.exponential(1.5)
  }),
  // Because Effect programs are evaluated lazily, nothing
  // will happen until the Effect is executed.
  //
  // Uncomment the line below to execute the Effect into
  // a JavaScript Promise.
  // Effect.runPromise
)
