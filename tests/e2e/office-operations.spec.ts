import { expect, test, type APIResponse, type Page } from "@playwright/test";

const BASE_URL = (process.env.CLOUDFRONT_URL ?? "").replace(/\/$/, "");
const OFFICE_EMAIL = process.env.TEST_OFFICE_EMAIL ?? "";
const OFFICE_PASSWORD = process.env.TEST_OFFICE_PASSWORD ?? "";

interface DocStatus {
  id: number | null;
  docId: string;
  name: string;
  uploaded: boolean;
  clerkValidated: boolean;
}

interface CustomerRecord {
  found: true;
  appointmentId: number;
  confirmationCode: string;
  officeId: number;
  status: string;
  firstName: string;
  lastName: string;
  identityVerified: boolean;
  prescreenCompleted: boolean;
  docs: DocStatus[];
}

interface TxnType {
  id: number;
  slug: string;
  name: string;
  status: string;
}

interface Clerk {
  id: number;
  skill_ids: number[];
}

interface QueueEntry {
  id: number;
  queue_number: number;
  confirmation_code: string;
  first_name: string;
  last_name: string;
  is_priority: boolean;
}

interface ServiceRecord {
  queueId: number;
  queueNumber: number;
  firstName: string;
  lastName: string;
}

async function responseJson<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), `${response.url()} returned ${response.status()}`).toBeTruthy();
  return response.json() as Promise<T>;
}

async function completePrescreen(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Pre-Screen|Already Completed/i).first()).toBeVisible();

  const radios = page.locator('input[type="radio"]');
  const alreadyCompleted = page.getByText(/Already Completed/i);
  await expect(radios.first().or(alreadyCompleted).first()).toBeVisible();
  if ((await radios.count()) === 0) {
    await expect(alreadyCompleted).toBeVisible();
    return;
  }

  const names = await radios.evaluateAll(
    (elements) =>
      [
        ...new Set(elements.map((element) => element.getAttribute("name")).filter(Boolean)),
      ] as string[],
  );
  for (const name of names) {
    await page.locator(`input[name="${name}"]`).first().check();
  }

  await page.getByRole("button", { name: /Submit/i }).click();
  await expect(
    page.getByText(/Pre-Screen Complete|close this page|checked in/i).first(),
  ).toBeVisible();
}

test.describe("deployed office operations", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  test.skip(
    !BASE_URL || !OFFICE_EMAIL || !OFFICE_PASSWORD,
    "CLOUDFRONT_URL and office test credentials are required",
  );

  test("booking through completed clerk service, including documents and priority", async ({
    page,
  }) => {
    test.setTimeout(300_000);

    const runId = Date.now().toString().slice(-8);
    const bookedFirstName = `E2E${runId}`;
    const bookedLastName = "Booked";
    const walkInFirstName = `E2E${runId}`;
    const walkInLastName = "PriorityWalkIn";
    const requestFailures: string[] = [];
    const consoleErrors: string[] = [];
    const artifacts: Record<string, unknown> = { runId };

    page.on("requestfailed", (request) => {
      requestFailures.push(
        `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`,
      );
    });
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    let authorization = "";
    const authHeaders = () => ({ Authorization: authorization });
    const apiPost = async <T>(path: string, data: unknown): Promise<T> =>
      responseJson<T>(
        await page.request.post(`${BASE_URL}${path}`, { headers: authHeaders(), data }),
      );
    const apiGet = async <T>(path: string): Promise<T> =>
      responseJson<T>(await page.request.get(`${BASE_URL}${path}`, { headers: authHeaders() }));

    await test.step("sign in and capture the staff API authorization", async () => {
      await page.goto(`${BASE_URL}/confirmation`, { waitUntil: "domcontentloaded" });
      await expect(page.getByText("Staff sign-in")).toBeVisible();
      await page.locator('input[type="email"]').fill(OFFICE_EMAIL);
      await page.locator('input[type="password"]').fill(OFFICE_PASSWORD);

      const authorizedRequest = page.waitForRequest(
        (request) =>
          request.url().includes("/api/config") && Boolean(request.headers().authorization),
      );
      await page.getByRole("button", { name: "Sign In" }).click();
      authorization = (await authorizedRequest).headers().authorization ?? "";

      expect(authorization).toMatch(/^Bearer /);
      await expect(page.getByRole("heading", { name: "Schedule an Appointment" })).toBeVisible();
    });

    let confirmationCode = "";
    await test.step("book a Road Test appointment with required documents", async () => {
      await page.locator('input[placeholder="Jane"]').fill(bookedFirstName);
      await page.locator('input[placeholder="Smith"]').fill(bookedLastName);
      await page.locator('input[placeholder="you@example.com"]').fill(OFFICE_EMAIL);
      await page.getByRole("button", { name: "Verify" }).click();
      await expect(page.getByText("Verified", { exact: true })).toBeVisible();

      const roadTest = page.getByRole("checkbox", { name: /Driving Road Test/ });
      await expect(roadTest).toHaveCount(1);
      await roadTest.check();
      await page.getByRole("button", { name: "Find Slot & Book Appointment" }).click();
      await expect(page.getByText("Appointment Confirmed")).toBeVisible();

      const body = await page.locator("body").innerText();
      confirmationCode = body.match(/Confirmation Code:\s*([A-Z0-9]+)/)?.[1] ?? "";
      expect(confirmationCode).toMatch(/^[A-Z0-9]{6,}$/);
      artifacts.confirmationCode = confirmationCode;
    });

    await test.step("complete the booked appointment pre-screen", async () => {
      await completePrescreen(page, `${BASE_URL}/prescreen/${confirmationCode}`);
    });

    let bookedRecord!: CustomerRecord;
    let bookedQueueId = 0;
    await test.step("upload and clerk-validate every required document, then check in", async () => {
      await page.goto(`${BASE_URL}/check-in?code=${confirmationCode}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByRole("heading", { name: `${bookedFirstName} ${bookedLastName}` }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Verify", exact: true }).click();
      await expect(page.getByText("Ready for queue")).not.toBeVisible();

      bookedRecord = await apiPost<CustomerRecord>("/api/lookup", { confirmationCode });
      expect(bookedRecord.docs.length).toBeGreaterThan(0);
      artifacts.bookedAppointmentId = bookedRecord.appointmentId;

      expect
        .soft(
          await page.locator('input[type="file"]').count(),
          "The check-in UI must expose a real document upload control",
        )
        .toBeGreaterThan(0);

      const onePixelPng =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7xkAAAAASUVORK5CYII=";
      for (const doc of bookedRecord.docs) {
        await apiPost<{ ok: true; documentId: number }>("/api/upload-document", {
          appointmentId: bookedRecord.appointmentId,
          docId: doc.docId,
          name: `e2e-${runId}-${doc.docId}.png`,
          contentType: "image/png",
          dataBase64: onePixelPng,
        });
      }

      await page.reload({ waitUntil: "domcontentloaded" });
      const validateButtons = page.getByRole("button", { name: "Validate" });
      await expect(validateButtons).toHaveCount(bookedRecord.docs.length);
      for (const doc of bookedRecord.docs) {
        const row = page
          .getByText(doc.name, { exact: true })
          .locator("xpath=ancestor::div[contains(@class, 'justify-between')][1]");
        const validateButton = row.getByRole("button", { name: "Validate" });
        await expect(validateButton).toBeVisible();
        await validateButton.click();
        await expect(row.getByText("Validated", { exact: true })).toBeVisible();
      }

      await expect(page.getByText("Ready for queue", { exact: true }).first()).toBeVisible();
      const checkInResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/check-in") && response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Check in to queue" }).click();
      const checkIn = await responseJson<{ queueId: number; queueNumber: number }>(
        await checkInResponse,
      );
      bookedQueueId = checkIn.queueId;
      artifacts.bookedQueue = checkIn;
      expect
        .soft(
          await page.getByText("Customer is in the queue.").count(),
          "The check-in card should refresh to its queued state after a successful POST",
        )
        .toBeGreaterThan(0);
      const queueAfterCheckIn = await apiGet<{ queue: QueueEntry[] }>("/api/live-queue");
      expect(queueAfterCheckIn.queue.some((entry) => entry.id === bookedQueueId)).toBe(true);
    });

    const officeId = bookedRecord.officeId;
    const config = await apiGet<{ txnTypes: TxnType[] }>("/api/config");
    const clerks = (await apiGet<{ clerks: Clerk[] }>(`/api/clerks?officeId=${officeId}`)).clerks;
    const documentHeavySlugs = new Set(["road-test", "id-card", "license-original"]);
    const serviceClerk = clerks.find((clerk) =>
      config.txnTypes.some(
        (txn) =>
          txn.status === "active" &&
          !documentHeavySlugs.has(txn.slug) &&
          clerk.skill_ids.includes(txn.id),
      ),
    );
    const walkInTxn = config.txnTypes.find(
      (txn) =>
        txn.status === "active" &&
        !documentHeavySlugs.has(txn.slug) &&
        serviceClerk?.skill_ids.includes(txn.id),
    );
    expect(
      serviceClerk,
      "An active service clerk with a non-document transaction is required",
    ).toBeDefined();
    expect(walkInTxn, "A serviceable walk-in transaction is required").toBeDefined();

    let walkInRecord!: CustomerRecord;
    await test.step("register a priority walk-in and complete its pre-screen into the queue", async () => {
      await page.goto(`${BASE_URL}/walk-in`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Walk-In Registration" })).toBeVisible();
      await page.locator('input[placeholder="First name"]').fill(walkInFirstName);
      await page.locator('input[placeholder="Last name"]').fill(walkInLastName);
      await page.locator('input[placeholder="email@example.com"]').fill(OFFICE_EMAIL);
      const txnLabel = page.locator("label").filter({ hasText: walkInTxn!.name });
      await txnLabel.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Mark Identity Verified" }).click();
      await expect(page.getByText("Identity verified by clerk")).toBeVisible();

      const walkInResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/walk-in") && response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Priority", exact: true }).click();
      const walkIn = await responseJson<{ appointmentId: number; pendingPrescreen: boolean }>(
        await walkInResponse,
      );
      expect(walkIn.pendingPrescreen).toBe(true);
      artifacts.walkInAppointmentId = walkIn.appointmentId;

      walkInRecord = await apiPost<CustomerRecord>("/api/lookup-by-id", {
        appointmentId: walkIn.appointmentId,
      });
      expect
        .soft(
          walkInRecord.identityVerified,
          "Walk-in identity verification selected in the UI must persist to the appointment",
        )
        .toBe(true);
      expect
        .soft(
          await page.getByRole("link", { name: /pre-screen/i }).count(),
          "Pending walk-ins need a visible pre-screen link or confirmation code",
        )
        .toBeGreaterThan(0);

      await completePrescreen(
        page,
        `${BASE_URL}/prescreen/${walkInRecord.confirmationCode}?autoCheckIn=1&priority=1`,
      );
    });

    await test.step("prove priority ordering in both the API and rendered queue", async () => {
      const liveQueue = await apiGet<{ queue: QueueEntry[] }>("/api/live-queue");
      const priorityIndex = liveQueue.queue.findIndex(
        (entry) => entry.confirmation_code === walkInRecord.confirmationCode,
      );
      const standardIndex = liveQueue.queue.findIndex(
        (entry) => entry.confirmation_code === confirmationCode,
      );
      expect(priorityIndex).toBeGreaterThanOrEqual(0);
      expect(standardIndex).toBeGreaterThanOrEqual(0);
      expect(priorityIndex).toBeLessThan(standardIndex);
      expect(liveQueue.queue[priorityIndex].is_priority).toBe(true);

      await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Live Queue" })).toBeVisible();
      const priorityName = page.getByText(`${walkInFirstName} ${walkInLastName}`, { exact: true });
      const standardName = page.getByText(`${bookedFirstName} ${bookedLastName}`, { exact: true });
      await expect(priorityName).toBeVisible();
      await expect(standardName).toBeVisible();
      const standardElement = await standardName.elementHandle();
      expect(standardElement).not.toBeNull();
      const priorityRenderedFirst = await priorityName.evaluate(
        (priorityElement, laterElement) =>
          Boolean(
            priorityElement.compareDocumentPosition(laterElement) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          ),
        standardElement,
      );
      expect(priorityRenderedFirst).toBe(true);
    });

    await test.step("summon, execute every clerk step, and verify completion", async () => {
      await page.goto(`${BASE_URL}/service`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Service Clerk Dashboard" })).toBeVisible();
      await page.locator("select").first().selectOption(String(serviceClerk!.id));
      await page.getByRole("button", { name: "Login" }).click();
      await expect(page.getByText("Available for customers")).toBeVisible();

      let serving = await apiGet<{ serving: boolean; record?: ServiceRecord }>(
        `/api/clerk/serving?clerkId=${serviceClerk!.id}&officeId=${officeId}`,
      );
      if (!serving.serving) {
        await page.getByRole("button", { name: "Summon Next", exact: true }).click();
        await expect(page.getByText(/Now Serving/)).toBeVisible();
        serving = await apiGet<{ serving: boolean; record?: ServiceRecord }>(
          `/api/clerk/serving?clerkId=${serviceClerk!.id}&officeId=${officeId}`,
        );
      }

      expect(serving.serving).toBe(true);
      expect(serving.record).toBeDefined();
      const servedQueueId = serving.record!.queueId;
      artifacts.served = serving.record;

      const validateButtons = page.getByRole("button", { name: "Validate" });
      for (let remaining = await validateButtons.count(); remaining > 0; remaining -= 1) {
        await validateButtons.first().click();
        await expect(validateButtons).toHaveCount(remaining - 1);
      }
      const markDoneButtons = page.getByRole("button", { name: "Mark Done" });
      for (let remaining = await markDoneButtons.count(); remaining > 0; remaining -= 1) {
        await markDoneButtons.first().click();
        await expect(markDoneButtons).toHaveCount(remaining - 1);
      }
      await expect(markDoneButtons).toHaveCount(0);
      await expect(page.getByText("Done", { exact: true })).toHaveCount(3);

      page.once("dialog", (dialog) => dialog.accept());
      const completionResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/clerk/complete") && response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Complete Only" }).click();
      await responseJson<{ ok: true; durationSec: number }>(await completionResponse);
      await expect(
        page.getByText("Login as a clerk and summon a customer to begin service."),
      ).toBeVisible();

      const afterServing = await apiGet<{ serving: boolean }>(
        `/api/clerk/serving?clerkId=${serviceClerk!.id}&officeId=${officeId}`,
      );
      expect(afterServing.serving).toBe(false);
      const afterQueue = await apiGet<{ queue: QueueEntry[] }>("/api/live-queue");
      expect(afterQueue.queue.some((entry) => entry.id === servedQueueId)).toBe(false);
      expect(bookedQueueId).toBeGreaterThan(0);
    });

    artifacts.requestFailures = requestFailures;
    artifacts.consoleErrors = consoleErrors;
    await test.info().attach("office-operations-run.json", {
      body: JSON.stringify(artifacts, null, 2),
      contentType: "application/json",
    });
  });
});
