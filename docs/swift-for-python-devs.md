# Swift for Python Developers

A mapping of Python concepts → Swift equivalents, focused on what you need for this SwiftUI app.

## Types & Variables

| Python | Swift | Notes |
|--------|-------|-------|
| `x = 5` | `var x = 5` | Mutable |
| `x = 5` (never reassigned) | `let x = 5` | Immutable. Swift prefers `let` by default |
| `x: str = "hello"` | `var x: String = "hello"` | Explicit type (usually inferred) |
| `x: str \| None = None` | `var x: String? = nil` | Optional. The `?` means "could be nil" |
| `list[str]` | `[String]` | Array |
| `dict[str, int]` | `[String: Int]` | Dictionary |
| `tuple[str, int]` | `(String, Int)` | Tuple |

### Optionals — Swift's biggest difference from Python

In Python, any variable can be `None`. In Swift, only variables marked `?` can be `nil`:

```swift
var name: String = "Dan"    // CANNOT be nil — compiler enforces this
var name: String? = nil     // CAN be nil

// Unwrapping (accessing the value inside an optional):
if let name = name {
    print(name)           // safe — only runs if name is not nil
}

// Force unwrap (like Python — crashes if nil):
print(name!)              // DON'T do this unless you're 100% sure

// Nil coalescing (like Python's `or`):
let display = name ?? "Unknown"   // Python: name or "Unknown"
```

## Data Structures

### struct vs class

```swift
// STRUCT — value type (like Python dataclass, BUT copied on assignment)
struct Point {
    var x: Double
    var y: Double
}
var a = Point(x: 1, y: 2)
var b = a        // b is a COPY
b.x = 99        // a.x is still 1

// CLASS — reference type (like Python class — shared pointer)
class Store {
    var count = 0
}
let a = Store()
let b = a        // b points to SAME object
b.count = 99     // a.count is also 99
```

**Rule of thumb**: Use `struct` for data, `class` for shared mutable state (stores).

### enum — Swift's killer feature

Python's `Enum` is just labels. Swift enums carry associated data:

```swift
// Python:
# You'd use a union of dataclasses or TypedDict with a "type" field
block = {"type": "text", "text": "hello"}
block = {"type": "tool_use", "id": "123", "name": "Read"}

// Swift:
enum ContentBlock {
    case text(String)
    case toolUse(id: String, name: String, input: [String: JSONValue])
    case thinking(thinking: String, signature: String?)
}

// Pattern matching (like Python 3.10 match/case, but exhaustive):
switch block {
case .text(let str):
    print(str)
case .toolUse(let id, let name, _):  // _ means "ignore this field"
    print("\(name) (\(id))")
case .thinking(let text, _):
    print(text)
}
// Compiler ERROR if you forget a case. No runtime surprises.
```

## Functions

```swift
// Python:
def greet(name: str, loud: bool = False) -> str:
    return f"Hello {name}{'!' if loud else '.'}"

// Swift:
func greet(name: String, loud: Bool = false) -> String {
    return "Hello \(name)\(loud ? "!" : ".")"
}

// Calling:
greet(name: "Dan")              // argument labels are required by default
greet(name: "Dan", loud: true)
```

### The underscore `_` — skipping argument labels

```swift
// With label (default):
func greet(name: String) { }
greet(name: "Dan")

// Without label (using _):
func greet(_ name: String) { }
greet("Dan")

// Different external vs internal name:
func greet(for person: String) { }
greet(for: "Dan")    // externally: "for", internally: "person"
```

### Closures (lambdas)

```swift
// Python:
names = ["Charlie", "Alice", "Bob"]
names.sort(key=lambda x: x.lower())
callback = lambda text: print(text)

// Swift:
var names = ["Charlie", "Alice", "Bob"]
names.sort { $0.lowercased() < $1.lowercased() }  // $0, $1 = positional args
let callback = { (text: String) in print(text) }

// Trailing closure syntax — when last arg is a closure, it goes outside ():
button.onTap { doSomething() }
// is short for:
button.onTap(action: { doSomething() })
```

## Error Handling

```swift
// Python:
try:
    data = json.loads(text)
except JSONDecodeError as e:
    print(f"Failed: {e}")

// Swift:
do {
    let data = try JSONDecoder().decode(MyType.self, from: jsonData)
} catch {
    print("Failed: \(error)")
}

// `try` keyword is MANDATORY before any throwing function.
// `try?` converts error to nil (like Python's except: pass):
let data = try? JSONDecoder().decode(MyType.self, from: jsonData)  // nil on failure
```

## Async/Await

Almost identical to Python:

```swift
// Python:
async def fetch_sessions() -> list[Session]:
    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        return response.json()

// Swift:
func fetchSessions() async throws -> [SessionInfo] {
    let (data, _) = try await URLSession.shared.data(from: url)
    return try JSONDecoder().decode([SessionInfo].self, from: data)
}
```

## JSON (Codable)

Swift's `Codable` protocol = Pydantic for Swift.

```swift
// Python (Pydantic):
class SessionInfo(BaseModel):
    id: str
    name: str
    summary: str
    updated_at: str

data = SessionInfo.model_validate_json(response.text)

// Swift:
struct SessionInfo: Codable {
    let id: String
    let name: String
    let summary: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id, name, summary
        case updatedAt = "updated_at"   // maps snake_case JSON → camelCase Swift
    }
}

let data = try JSONDecoder().decode(SessionInfo.self, from: jsonData)
```

Key point: `CodingKeys` maps JSON field names to Swift property names. Only needed when names differ (like `updated_at` → `updatedAt`).

## Protocols (= Python ABCs / Interfaces)

```swift
// Python:
from abc import ABC, abstractmethod
class Identifiable(ABC):
    @property
    @abstractmethod
    def id(self) -> str: ...

// Swift:
protocol Identifiable {
    var id: String { get }
}

// Conforming (like inheriting):
struct Message: Identifiable, Codable {  // can conform to multiple
    let id = UUID()
}
```

Common protocols in this project:
- `Codable` — can serialize to/from JSON
- `Identifiable` — has an `id` (needed for SwiftUI lists)
- `Sendable` — safe to pass between threads
- `Equatable` — can use `==`

## SwiftUI Basics

### Views are structs with a `body`

```swift
struct MyView: View {
    var body: some View {     // computed property, called by SwiftUI on state change
        Text("Hello")
    }
}
```

### State & Reactivity

```swift
// Svelte:
let count = $state(0);           // reactive
let doubled = $derived(count * 2); // computed

// SwiftUI:
@State var count = 0              // reactive — view re-renders on change
var doubled: Int { count * 2 }    // computed property (no decorator needed)
```

| Svelte | SwiftUI | When to use |
|--------|---------|-------------|
| `$state()` | `@State` | Local view state (simple values) |
| `$state()` in `.svelte.ts` | `@Observable class` | Shared store (complex state) |
| `getContext()` | `@Environment` | Dependency injection |
| `$derived()` | Computed property | Derived values |
| `$effect()` | `.onChange()` / `.task {}` | Side effects |
| `bind:value` | `$binding` (e.g. `$text`) | Two-way binding |
| `{#if}` | `if` | Conditional |
| `{#each}` | `ForEach` or `List` | Loops |
| `on:click` | `Button(action:)` or `.onTapGesture` | Events |

### Modifiers (= CSS in code)

```swift
Text("Hello")
    .font(.headline)                // font-size + weight
    .foregroundStyle(.secondary)    // color
    .padding(8)                     // padding
    .background(Color.blue)         // background-color
    .clipShape(RoundedRectangle(cornerRadius: 8))  // border-radius
```

Each `.modifier()` wraps the view in a new view. Order matters (padding before background ≠ background before padding).

### Navigation

```swift
// Svelte (hash router):
push('/live/session-123')

// SwiftUI:
NavigationStack {
    SessionListView()
        .navigationDestination(for: String.self) { id in
            LiveView(sessionId: id)
        }
}
// Tap a NavigationLink(value: "session-123") → navigates automatically
```

### Lifecycle

```swift
// Svelte:
onMount(async () => { await load() });
onDestroy(() => { cleanup() });

// SwiftUI:
.task { await load() }           // runs on appear, auto-cancels on disappear
.onAppear { setup() }           // sync version
.onDisappear { cleanup() }      // cleanup
```

## String Interpolation

```swift
// Python:
f"Hello {name}, you have {count} items"

// Swift:
"Hello \(name), you have \(count) items"
```

## Project Structure Cheat Sheet

```
project.yml          ← package.json (defines deps, build target)
xcodegen generate    ← npm install (generates .xcodeproj)
xcodebuild build     ← npm run build

Reduck/
├── ReduckApp.swift  ← main.py / cli.ts (entry point, @main)
├── Models/          ← types.ts / chat-types.ts (data structures)
├── Services/        ← converse.ts, gemini.ts, audio.ts (I/O logic)
├── Stores/          ← data.svelte.ts, ui.svelte.ts (state management)
├── Views/           ← .svelte files (UI components)
└── Utilities/       ← message-helpers.ts (pure functions)
```

## Common Gotchas

1. **Everything is typed** — no `Any` if you can avoid it. The compiler is strict but saves you from runtime crashes.

2. **`let` vs `var`** — start with `let`. The compiler tells you when you need `var`.

3. **Semicolons are optional** — don't use them. One statement per line.

4. **No `self` needed** — unlike Python, you don't write `self.` to access properties (except in closures that capture `self`, where Swift makes you explicit).

5. **`guard let` = early return unwrap**:
   ```swift
   // Python:
   if name is None:
       return
   # name is guaranteed non-None here

   // Swift:
   guard let name = name else { return }
   // name is guaranteed non-nil here (unwrapped)
   ```

6. **The build catches most bugs** — if `xcodebuild` succeeds, types are correct, optionals are handled, and all enum cases are covered. Trust the compiler.
