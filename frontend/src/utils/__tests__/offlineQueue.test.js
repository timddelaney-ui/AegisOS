import { enqueue, flush, peekQueue, pendingQueueCount, setQueueSender, resetQueueForTests } from "../offlineQueue";

jest.mock("axios", () => ({ defaults: {}, get: jest.fn(), post: jest.fn() }));

beforeEach(async () => {
  await resetQueueForTests();
  Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
});

test("assigns monotonically increasing sequence numbers", async () => {
  const a = await enqueue("job_log", { n: 1 });
  const b = await enqueue("task_completion", { n: 2 });
  const c = await enqueue("parts_request", { n: 3 });
  expect(b.seq).toBeGreaterThan(a.seq);
  expect(c.seq).toBeGreaterThan(b.seq);
  expect(await pendingQueueCount()).toBe(3);
});

test("flushes in order and stops at the first transient failure", async () => {
  const seen = [];
  let fail = true;
  setQueueSender(async (item) => {
    if (item.payload.n === 2 && fail) throw new Error("Network Error");
    seen.push(item.payload.n);
  });
  await enqueue("job_log", { n: 1 });
  await enqueue("job_log", { n: 2 });
  await enqueue("job_log", { n: 3 });
  expect(await flush()).toBe(1);
  expect(seen).toEqual([1]);
  expect(await pendingQueueCount()).toBe(2);
  fail = false;
  expect(await flush()).toBe(2);
  expect(seen).toEqual([1, 2, 3]);
  expect(await pendingQueueCount()).toBe(0);
});

test("a permanently rejected row does not block later rows", async () => {
  setQueueSender(async (item) => { if (item.payload.n === 1) throw { response: { status: 422 } }; });
  await enqueue("job_log", { n: 1 });
  await enqueue("job_log", { n: 2 });
  expect(await flush()).toBe(1);
  expect((await peekQueue()).map((r) => r.failed)).toEqual([true]);
});

test("rejects unknown types", async () => {
  await expect(enqueue("bogus", {})).rejects.toThrow();
});
