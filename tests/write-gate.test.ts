import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createScriptedSpExecutionContextAdapter,
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";
import { SpApiError, SpApiPreCommitError } from
  "../src/main/amazon/sp-api-error";
import { LocalStore } from "../src/main/local-store";
import {
  MainWriteGate,
  type MainWriteAttemptControl,
  type MainWriteAttemptInput,
  type MainWriteGateExecuteInput,
  type WriteBinding,
  type WriteIntent,
} from "../src/main/write-gate";

const US = "ATVPDKIKX0DER" as const;

async function testStore(): Promise<LocalStore> {
  const directory = await mkdtemp(join(tmpdir(), "amz-write-gate-"));
  const store = new LocalStore(join(directory, "data.json"));
  await store.initialize();
  return store;
}

function scriptedContext(): SpExecutionContextAdapter {
  return createScriptedSpExecutionContextAdapter((marketplaceId) => ({
    marketplaceId,
    mode: "demo",
    accountScope: "opaque-write-gate-account",
  }));
}

function writeBinding(
  context: SpExecutionContext,
  input: Readonly<{
    family?: WriteBinding["family"];
    operation?: WriteIntent["operation"];
    previewKey?: string;
    intentId?: string;
    sellerSku?: string;
    idempotencyKey?: string;
    proposalFingerprint?: string;
  }> = {},
): WriteBinding {
  return {
    family: input.family ?? "standard-price",
    previewKey: input.previewKey ?? "price-preview-key",
    context,
    intents: [{
      intentId: input.intentId ?? "price-intent",
      operation: input.operation ?? "price",
      marketplaceId: context.marketplaceId,
      sellerSku: input.sellerSku ?? "WRITE-GATE-SKU",
      idempotencyKey: input.idempotencyKey ?? "write-gate-idempotency-key",
      proposalFingerprint: input.proposalFingerprint ?? "price-14.99-to-15.99",
    }],
  };
}

function runOne<T>(
  gate: MainWriteGate,
  binding: WriteBinding,
  execute: MainWriteAttemptInput<T>["execute"],
  options: Pick<
    MainWriteGateExecuteInput<T>,
    "beforeApproval" | "cancellationMessage"
  > = {},
): Promise<T> {
  return gate.execute({
    binding,
    approvalReason: "Confirm this scripted Amazon write",
    ...options,
    run: (session) => session.attempt({
      intentId: binding.intents[0].intentId,
      execute,
    }),
  });
}

describe("main-owned Amazon write gate", () => {
  it("releases a native-cancelled preview so retry executes exactly once", async () => {
    const store = await testStore();
    const contextAdapter = scriptedContext();
    const context = await contextAdapter.capture(US);
    const approveWrite = vi.fn(async (_reason: string) => undefined);
    approveWrite.mockRejectedValueOnce(new Error("native approval cancelled"));
    const gate = new MainWriteGate({ store, context: contextAdapter, approveWrite });
    const binding = writeBinding(context);
    const execute = vi.fn(async () => ({ status: "verified" }));

    await gate.stagePreview(binding);
    await expect(runOne(gate, binding, execute)).rejects.toMatchObject({
      code: "ACTION_CANCELLED",
      status: 409,
    });
    await expect(runOne(gate, binding, execute)).resolves.toEqual({
      status: "verified",
    });

    expect(approveWrite).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("releases a preview when the one-shot post-native context fence fails before send", async () => {
    const store = await testStore();
    const baseContext = scriptedContext();
    let failNextFence = false;
    const contextAdapter: SpExecutionContextAdapter = {
      capture: (marketplaceId) => baseContext.capture(marketplaceId),
      invalidate: (reason) => baseContext.invalidate(reason),
      async assertCurrent(context) {
        if (failNextFence) {
          failNextFence = false;
          throw new SpExecutionContextError(
            "SP_CONTEXT_INVALIDATED",
            "one-shot post-native fence failure",
          );
        }
        await baseContext.assertCurrent(context);
      },
    };
    const context = await contextAdapter.capture(US);
    let approvalCount = 0;
    const approveWrite = vi.fn(async () => {
      approvalCount += 1;
      if (approvalCount === 1) failNextFence = true;
    });
    const gate = new MainWriteGate({ store, context: contextAdapter, approveWrite });
    const binding = writeBinding(context, {
      previewKey: "post-native-fence",
      idempotencyKey: "post-native-fence-key",
    });
    const execute = vi.fn(async () => ({ status: "verified" }));

    await gate.stagePreview(binding);
    await expect(runOne(gate, binding, execute)).rejects.toMatchObject({
      code: "SP_CONTEXT_INVALIDATED",
      status: 409,
    });
    expect(execute).not.toHaveBeenCalled();

    await expect(runOne(gate, binding, execute)).resolves.toEqual({
      status: "verified",
    });
    expect(approveWrite).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("keeps an ambiguous 429 durable across ephemeral clear and gate restart", async () => {
    const store = await testStore();
    const contextAdapter = scriptedContext();
    const context = await contextAdapter.capture(US);
    const approveWrite = vi.fn(async () => undefined);
    const binding = writeBinding(context, {
      previewKey: "durable-unknown-preview",
      idempotencyKey: "durable-unknown-key",
      proposalFingerprint: "price-15.99-to-16.99",
    });
    let executeCount = 0;
    const execute = vi.fn(async () => {
      executeCount += 1;
      if (executeCount === 1) {
        throw new SpApiError("Amazon returned 429 after PATCH dispatch", {
          status: 429,
          code: "UPSTREAM_RATE_LIMITED",
        });
      }
      return { status: "must-not-replay" };
    });
    const firstGate = new MainWriteGate({
      store,
      context: contextAdapter,
      approveWrite,
    });

    await firstGate.stagePreview(binding);
    await expect(runOne(firstGate, binding, execute)).rejects.toMatchObject({
      code: "UPDATE_STATUS_UNKNOWN",
      status: 429,
    });
    firstGate.clearEphemeral();

    const restartedGate = new MainWriteGate({
      store,
      context: contextAdapter,
      approveWrite,
    });
    await restartedGate.stagePreview(binding);
    await expect(runOne(restartedGate, binding, execute)).rejects.toMatchObject({
      code: "UPDATE_STATUS_UNKNOWN",
      status: 409,
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("releases a proven pre-commit failure so a fresh preview may execute", async () => {
    const store = await testStore();
    const contextAdapter = scriptedContext();
    const context = await contextAdapter.capture(US);
    const gate = new MainWriteGate({
      store,
      context: contextAdapter,
      approveWrite: async () => undefined,
    });
    const binding = writeBinding(context, {
      previewKey: "pre-commit-preview",
      idempotencyKey: "pre-commit-key",
      proposalFingerprint: "price-16.99-to-17.99",
    });
    let executeCount = 0;
    const execute = vi.fn(async () => {
      executeCount += 1;
      if (executeCount === 1) {
        throw new SpApiPreCommitError(new SpApiError(
          "Amazon Validation Preview rejected the proposal",
          { status: 400, code: "VALIDATION_FAILED" },
        ));
      }
      return { status: "verified" };
    });

    await gate.stagePreview(binding);
    await expect(runOne(gate, binding, execute)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
      commitPatchSent: false,
    });

    await gate.stagePreview(binding);
    await expect(runOne(gate, binding, execute)).resolves.toEqual({
      status: "verified",
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("atomically excludes content and image writes for one SKU and releases afterward", async () => {
    const store = await testStore();
    const contextAdapter = scriptedContext();
    const context = await contextAdapter.capture(US);
    const approveWrite = vi.fn(async () => undefined);
    const gate = new MainWriteGate({ store, context: contextAdapter, approveWrite });
    const content = writeBinding(context, {
      family: "content",
      operation: "content",
      previewKey: "content-preview",
      intentId: "content-intent",
      sellerSku: "SHARED-ATTRIBUTE-SKU",
      idempotencyKey: "content-write-key",
      proposalFingerprint: "content-proposal",
    });
    const images = writeBinding(context, {
      family: "images",
      operation: "images",
      previewKey: "images-preview",
      intentId: "images-intent",
      sellerSku: "SHARED-ATTRIBUTE-SKU",
      idempotencyKey: "images-write-key",
      proposalFingerprint: "images-proposal",
    });
    let releaseContent!: () => void;
    const contentRelease = new Promise<void>((resolve) => {
      releaseContent = resolve;
    });
    let contentReserved!: () => void;
    const contentReservation = new Promise<void>((resolve) => {
      contentReserved = resolve;
    });
    const contentSend = vi.fn(async () => ({ family: "content" }));
    const imageSend = vi.fn(async () => ({ family: "images" }));

    await gate.stagePreview(content);
    await gate.stagePreview(images);
    const first = runOne(gate, content, contentSend, {
      beforeApproval: async () => {
        contentReserved();
        await contentRelease;
      },
    });
    await contentReservation;

    try {
      await expect(runOne(gate, images, imageSend)).rejects.toMatchObject({
        code: "OPERATION_IN_PROGRESS",
        status: 409,
      });
      expect(imageSend).not.toHaveBeenCalled();
    } finally {
      releaseContent();
    }
    await expect(first).resolves.toEqual({ family: "content" });

    await expect(runOne(gate, images, imageSend)).resolves.toEqual({
      family: "images",
    });
    expect(contentSend).toHaveBeenCalledOnce();
    expect(imageSend).toHaveBeenCalledOnce();
    expect(approveWrite).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      label: "operation",
      base: {
        family: "variation-move" as const,
        operation: "variation_detach" as const,
      },
      patch: { operation: "variation_attach" as const },
    },
    {
      label: "proposal",
      base: {},
      patch: { proposalFingerprint: "different-proposal" },
    },
    {
      label: "idempotency key",
      base: {},
      patch: { idempotencyKey: "different-idempotency-key" },
    },
  ])("rejects $label binding drift before approval or send", async ({
    base,
    patch,
  }) => {
    const store = await testStore();
    const contextAdapter = scriptedContext();
    const context = await contextAdapter.capture(US);
    const approveWrite = vi.fn(async () => undefined);
    const gate = new MainWriteGate({ store, context: contextAdapter, approveWrite });
    const staged = writeBinding(context, {
      ...base,
      previewKey: `binding-drift-${base.family ?? "standard-price"}`,
      idempotencyKey: "binding-drift-key",
    });
    const drifted: WriteBinding = {
      ...staged,
      intents: [{ ...staged.intents[0], ...patch }],
    };
    const send = vi.fn(async () => ({ status: "must-not-send" }));

    await gate.stagePreview(staged);
    await expect(runOne(gate, drifted, send)).rejects.toMatchObject({
      code: "PREVIEW_CHANGED",
      status: 409,
    });
    expect(approveWrite).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects context binding drift before approval or send", async () => {
    const store = await testStore();
    const contextAdapter = scriptedContext();
    const stagedContext = await contextAdapter.capture(US);
    const approveWrite = vi.fn(async () => undefined);
    const gate = new MainWriteGate({ store, context: contextAdapter, approveWrite });
    const staged = writeBinding(stagedContext, {
      previewKey: "context-drift-preview",
      idempotencyKey: "context-drift-key",
    });
    await gate.stagePreview(staged);

    contextAdapter.invalidate("account-changed");
    const freshContext = await contextAdapter.capture(US);
    const drifted: WriteBinding = { ...staged, context: freshContext };
    const send = vi.fn(async () => ({ status: "must-not-send" }));

    await expect(runOne(gate, drifted, send)).rejects.toMatchObject({
      code: "PREVIEW_EXPIRED",
      status: 409,
    });
    expect(approveWrite).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("completes an accepted unknown only after an exact canonical observation", async () => {
    const store = await testStore();
    const contextAdapter = scriptedContext();
    const context = await contextAdapter.capture(US);
    const gate = new MainWriteGate({
      store,
      context: contextAdapter,
      approveWrite: async () => undefined,
    });
    const binding = writeBinding(context, {
      previewKey: "reconciliation-preview",
      sellerSku: "RECONCILE-SKU",
      idempotencyKey: "reconciliation-key",
      proposalFingerprint: "price-17.99-to-18.99",
    });
    const accepted = { status: "ACCEPTED", targetPrice: 18.99 } as const;
    const verified = { status: "VERIFIED", targetPrice: 18.99 } as const;
    const send = vi.fn(async (
      control: MainWriteAttemptControl<typeof accepted>,
    ): Promise<typeof accepted> => {
      await control.recordAccepted(accepted);
      throw new SpApiError("canonical readback timed out", {
        status: 503,
        code: "UPDATE_STATUS_UNKNOWN",
      });
    });
    const project = (
      response: unknown,
      operation: WriteIntent["operation"],
      snapshot: Readonly<{ price: number }>,
    ): typeof verified | null => {
      if (
        operation !== "price" ||
        typeof response !== "object" ||
        response === null ||
        !("targetPrice" in response) ||
        response.targetPrice !== snapshot.price
      ) {
        return null;
      }
      return verified;
    };

    await gate.stagePreview(binding);
    await expect(runOne<typeof accepted>(gate, binding, send)).rejects.toMatchObject({
      code: "UPDATE_STATUS_UNKNOWN",
      status: 503,
    });

    await gate.reconcile({
      context,
      marketplaceId: US,
      sellerSku: "RECONCILE-SKU",
      operations: ["price"],
      snapshot: { price: 18.49 },
      project,
    });
    const mustNotReplay = vi.fn(async () => accepted);
    await gate.stagePreview(binding);
    await expect(runOne(gate, binding, mustNotReplay)).rejects.toMatchObject({
      code: "UPDATE_STATUS_UNKNOWN",
      status: 409,
    });
    expect(mustNotReplay).not.toHaveBeenCalled();

    await gate.reconcile({
      context,
      marketplaceId: US,
      sellerSku: "RECONCILE-SKU",
      operations: ["price"],
      snapshot: { price: 18.99 },
      project,
    });
    await gate.stagePreview(binding);
    await expect(runOne(gate, binding, mustNotReplay)).resolves.toEqual(verified);
    expect(send).toHaveBeenCalledOnce();
    expect(mustNotReplay).not.toHaveBeenCalled();
  });
});
