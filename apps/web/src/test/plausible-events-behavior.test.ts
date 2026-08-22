// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyticsEventNames } from "../lib/analytics/catalog";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const plausibleEventsScript = readFileSync(
  join(testDirectory, "../../public/js/plausible-events.js"),
  "utf8",
);

const pageMetaTags =
  '<meta name="mr-analytics-locale" content="ca" />' +
  '<meta name="mr-analytics-page-type" content="home" />';

type Harness = {
  dom: JSDOM;
  plausible: ReturnType<typeof vi.fn>;
};

function recurringInterval(callback: () => void, delay: number): number {
  const tick = () => {
    callback();
    globalThis.setTimeout(tick, delay);
  };
  globalThis.setTimeout(tick, delay);
  return 0;
}

function createHarness(
  options: {
    body?: string;
    interval?: (callback: () => void, delay: number) => number;
    pathname?: string;
  } = {},
): Harness {
  const dom = new JSDOM(
    `<!doctype html><html><head>${pageMetaTags}</head><body>${
      options.body ?? ""
    }</body></html>`,
    {
      runScripts: "outside-only",
      url: `https://mountainrunners.cat${options.pathname ?? "/ca/"}`,
    },
  );
  // The client script reads Date.now and window.setInterval from its realm,
  // so both are replaced with the Node implementations before it runs: the
  // Vitest fake timers then drive the dwell clock and the interval. jsdom
  // reports "prerender" by default, so the visible state is forced to match
  // a rendered page.
  Object.defineProperty(dom.window.document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  dom.window.Date = Date;
  dom.window.setInterval = (options.interval ??
    (() => 0)) as typeof dom.window.setInterval;
  const plausible = vi.fn();
  dom.window.plausible = plausible;
  dom.window.eval(plausibleEventsScript);
  return { dom, plausible };
}

let activeDom: JSDOM | undefined;

afterEach(() => {
  vi.useRealTimers();
  activeDom?.window.close();
  activeDom = undefined;
});

describe("UI Action emission", () => {
  it("emits a UI Action with sanitized props on an instrumented click", () => {
    const { dom, plausible } = createHarness({
      body: '<a id="link" data-analytics-action="navigate" data-analytics-area="header_nav" data-analytics-target="events" href="/ca/esdeveniments/">Events</a>',
    });
    activeDom = dom;

    dom.window.document.getElementById("link")!.click();

    expect(plausible).toHaveBeenCalledWith(analyticsEventNames.uiAction, {
      props: {
        action: "navigate",
        area: "header_nav",
        locale: "ca",
        page_type: "home",
        route: "/ca/",
        target: "events",
      },
    });
  });

  it("resolves the instrumented element from a nested click target", () => {
    const { dom, plausible } = createHarness({
      body: '<a id="link" data-analytics-action="navigate" data-analytics-area="footer_nav" data-analytics-target="events" href="/ca/esdeveniments/"><span id="inner">Events</span></a>',
    });
    activeDom = dom;

    dom.window.document.getElementById("inner")!.click();

    expect(plausible).toHaveBeenCalledTimes(1);
    expect(plausible).toHaveBeenCalledWith(analyticsEventNames.uiAction, {
      props: expect.objectContaining({
        action: "navigate",
        area: "footer_nav",
        target: "events",
      }),
    });
  });

  it("ignores clicks on elements without analytics attributes", () => {
    const { dom, plausible } = createHarness({
      body: '<a id="plain" href="/ca/">Home</a>',
    });
    activeDom = dom;

    dom.window.document.getElementById("plain")!.click();

    expect(plausible).not.toHaveBeenCalled();
  });

  it("emits nothing and never throws when the plausible queue is missing", () => {
    const { dom } = createHarness({
      body: '<a id="link" data-analytics-action="navigate" data-analytics-area="header_nav" href="/ca/">Home</a>',
    });
    activeDom = dom;
    delete dom.window.plausible;

    expect(() =>
      dom.window.document.getElementById("link")!.click(),
    ).not.toThrow();
  });
});

describe("Page Dwell emission", () => {
  it("fires each threshold once while the page stays visible", () => {
    vi.useFakeTimers();
    const { dom, plausible } = createHarness({
      interval: recurringInterval,
    });
    activeDom = dom;

    vi.advanceTimersByTime(16000);
    expect(plausible).toHaveBeenCalledTimes(1);
    expect(plausible).toHaveBeenLastCalledWith(analyticsEventNames.pageDwell, {
      props: expect.objectContaining({
        locale: "ca",
        page_type: "home",
        route: "/ca/",
        threshold: "15",
      }),
    });

    vi.advanceTimersByTime(15000);
    expect(plausible).toHaveBeenCalledTimes(2);
    expect(plausible).toHaveBeenLastCalledWith(analyticsEventNames.pageDwell, {
      props: expect.objectContaining({ threshold: "30" }),
    });
  });

  it("pauses the visible clock while the tab is hidden", () => {
    vi.useFakeTimers();
    const { dom, plausible } = createHarness({
      interval: recurringInterval,
    });
    activeDom = dom;

    vi.advanceTimersByTime(16000);
    expect(plausible).toHaveBeenCalledTimes(1);

    Object.defineProperty(dom.window.document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange"));
    vi.advanceTimersByTime(60000);
    expect(plausible).toHaveBeenCalledTimes(1);

    Object.defineProperty(dom.window.document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange"));
    vi.advanceTimersByTime(15000);
    expect(plausible).toHaveBeenCalledTimes(2);
    expect(plausible).toHaveBeenLastCalledWith(analyticsEventNames.pageDwell, {
      props: expect.objectContaining({ threshold: "30" }),
    });
  });

  it("fires the due thresholds when the tab is hidden without a pending tick", () => {
    vi.useFakeTimers();
    const { dom, plausible } = createHarness();
    activeDom = dom;

    vi.advanceTimersByTime(20000);
    Object.defineProperty(dom.window.document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange"));

    expect(plausible).toHaveBeenCalledWith(analyticsEventNames.pageDwell, {
      props: expect.objectContaining({ threshold: "15" }),
    });
    expect(plausible).not.toHaveBeenCalledWith(analyticsEventNames.pageDwell, {
      props: expect.objectContaining({ threshold: "30" }),
    });
  });

  it("fires the due thresholds when the page is unloaded", () => {
    vi.useFakeTimers();
    const { dom, plausible } = createHarness();
    activeDom = dom;

    vi.advanceTimersByTime(20000);
    dom.window.dispatchEvent(new dom.window.Event("pagehide"));

    expect(plausible).toHaveBeenCalledWith(analyticsEventNames.pageDwell, {
      props: expect.objectContaining({ threshold: "15" }),
    });
    expect(plausible).toHaveBeenCalledTimes(1);
  });
});
