import * as NodeNet from "node:net";

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";
import { wave } from "./audio.ts";

export const HANDY_SPEECH_MODEL_ID = "local/handy";
export const HANDY_SPEECH_MODEL_NAME = "Handy";
export const HANDY_SPEECH_MODEL_DESCRIPTION =
  "Your installed Handy app with its own model, custom words, text rules and learned corrections";

const HANDY_APP_BINARY = "Handy.app/Contents/MacOS/handy";
const HANDY_SOCKET = "Library/Application Support/com.pais.handy/transcribe.sock";
const HANDY_TIMEOUT = "2 minutes";

const HandyResult = Schema.Struct({
  text: Schema.String,
  model: Schema.optional(Schema.String),
  load_ms: Schema.optional(Schema.Number),
  transcribe_ms: Schema.optional(Schema.Number),
  audio_secs: Schema.optional(Schema.Number),
});
const decodeHandyResult = Schema.decodeUnknownOption(Schema.fromJsonString(HandyResult));
// prepare replies carry no text.
const HandyReply = Schema.Struct({
  ...HandyResult.fields,
  ok: Schema.Literal(true),
  text: Schema.optional(Schema.String),
});
const decodeSocketReply = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Union([Schema.Struct({ ok: Schema.Literal(false), error: Schema.String }), HandyReply]),
  ),
);

export class HandyTranscriptionError extends Schema.TaggedError<HandyTranscriptionError>()(
  "HandyTranscriptionError",
  {
    exitCode: Schema.NullOr(Schema.Number),
    stderr: Schema.String,
    reason: Schema.optional(Schema.String),
  },
) {}

const socketError = (reason: string) =>
  new HandyTranscriptionError({ exitCode: null, stderr: "", reason });

/** Handy prints log lines around one JSON result line on stdout; the last one wins. */
function parseHandyOutput(stdout: string): typeof HandyResult.Type | undefined {
  const lines = stdout.split("\n");
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]!.trim();
    if (!line.startsWith("{")) continue;
    const result = decodeHandyResult(line);
    if (Option.isSome(result)) return result.value;
  }
  return undefined;
}

/** One request per connection; undefined means nothing listens, so the caller may fall back. */
const requestSocket = (path: string, request: object) =>
  Effect.callback<string | undefined, HandyTranscriptionError>((resume) => {
    let connected = false;
    let settled = false;
    let reply = "";
    const settle = (effect: Effect.Effect<string | undefined, HandyTranscriptionError>) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resume(effect);
    };
    const socket = NodeNet.createConnection(path);
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      connected = true;
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("data", (chunk: string) => {
      reply += chunk;
      const end = reply.indexOf("\n");
      if (end >= 0) settle(Effect.succeed(reply.slice(0, end)));
    });
    socket.on("end", () => settle(Effect.succeed(reply)));
    socket.on("error", (error: NodeJS.ErrnoException) => {
      settle(
        !connected && (error.code === "ENOENT" || error.code === "ECONNREFUSED")
          ? Effect.undefined
          : Effect.fail(socketError(error.message)),
      );
    });
    return Effect.sync(() => socket.destroy());
  });

export const makeHandy = Effect.fn("Handy.make")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { join } = yield* Path.Path;
  const runner = yield* ProcessRunner.ProcessRunner;
  const home = yield* HostProcess.HomeDirectory;

  const override = (name: string) =>
    Config.String(name).pipe(
      Config.option,
      Effect.orElseSucceed(() => Option.none<string>()),
      Effect.map((value) =>
        value.pipe(
          Option.map((text) => text.trim()),
          Option.filter(Boolean),
        ),
      ),
    );
  const exists = (path: string) => fs.exists(path).pipe(Effect.orElseSucceed(() => false));

  // An explicit T3CODE_HANDY_BIN is the only candidate, so a wrong override never falls back.
  const binary = Effect.gen(function* () {
    const configured = yield* override("T3CODE_HANDY_BIN");
    const candidates = Option.isSome(configured)
      ? [configured.value]
      : [join("/Applications", HANDY_APP_BINARY), join(home, "Applications", HANDY_APP_BINARY)];
    return Option.getOrUndefined(yield* Effect.findFirst(candidates, exists));
  });
  const socketPath = override("T3CODE_HANDY_SOCKET").pipe(
    Effect.map(Option.getOrElse(() => join(home, HANDY_SOCKET))),
  );
  /** Where Handy is reachable: the binary, else the running app's socket. */
  const available = Effect.gen(function* () {
    const command = yield* binary;
    if (command !== undefined) return command;
    const socket = yield* socketPath;
    return (yield* exists(socket)) ? socket : undefined;
  });

  const request = (op: object) =>
    socketPath.pipe(
      Effect.flatMap((path) => requestSocket(path, op)),
      Effect.timeoutOrElse({
        duration: HANDY_TIMEOUT,
        orElse: () => Effect.fail(socketError("Handy did not reply in time.")),
      }),
    );
  const decodeReply = (
    line: string,
  ): Effect.Effect<typeof HandyReply.Type, HandyTranscriptionError> =>
    Option.match(decodeSocketReply(line), {
      onNone: () => Effect.fail(socketError("Handy sent a malformed reply.")),
      onSome: (reply) => (reply.ok ? Effect.succeed(reply) : Effect.fail(socketError(reply.error))),
    });

  // The running app keeps its model loaded, so preparing while the user speaks hides the load.
  const prepare = request({ op: "prepare" }).pipe(
    Effect.flatMap((line) => (line === undefined ? Effect.void : decodeReply(line))),
    Effect.asVoid,
  );

  // The headless fallback loads its own model copy on every call (~1.8 s).
  const headless = Effect.fn("Handy.headless")(function* (file: string) {
    const command = yield* binary;
    if (command === undefined) return yield* socketError("Handy is neither running nor installed.");
    const output = yield* runner.run({
      command,
      args: ["--transcribe-file", file, "--json"],
      timeout: HANDY_TIMEOUT,
    });
    const result = output.code === 0 ? parseHandyOutput(output.stdout) : undefined;
    if (result === undefined)
      return yield* new HandyTranscriptionError({
        exitCode: output.code,
        stderr: output.stderr.slice(-2000),
      });
    return result;
  });

  const transcribe = Effect.fn("Handy.transcribe")(function* (samples: Float32Array) {
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-handy-" });
    const file = join(directory, "dictation.wav");
    yield* fs.writeFile(file, new Uint8Array(wave(samples)));
    const [elapsed, [path, result]] = yield* Effect.timed(
      Effect.gen(function* () {
        const line = yield* request({ op: "transcribe", wav: file });
        if (line === undefined) return ["headless", yield* headless(file)] as const;
        const reply = yield* decodeReply(line);
        if (reply.text === undefined) return yield* socketError("Handy sent a malformed reply.");
        return ["socket", { ...reply, text: reply.text }] as const;
      }),
    );
    yield* Effect.logInfo("Handy transcription").pipe(
      Effect.annotateLogs({
        path,
        model: result.model,
        load_ms: result.load_ms,
        transcribe_ms: result.transcribe_ms,
        audio_secs: result.audio_secs,
        total_ms: Duration.toMillis(elapsed),
      }),
    );
    return result.text;
  }, Effect.scoped);

  return { available, prepare, transcribe };
});
