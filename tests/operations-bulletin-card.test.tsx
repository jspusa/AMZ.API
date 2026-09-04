import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import OperationsBulletinCard, {
  calendarMonthCells,
  countdownPresentation,
  millisecondsUntilNextTaipeiDay,
  type OperationsBoardResponse,
} from "../src/renderer/src/components/operations-bulletin-card";
import { readRendererStylesheet } from "./renderer-stylesheet";

const BOARD: OperationsBoardResponse = {
  snapshot: {
    schemaVersion: 2,
    revision: 7,
    updatedAt: "2026-09-01T02:30:00.000Z",
    items: [
      {
        id: "expiry-ASCL01",
        type: "expiry",
        marketplaceId: "ATVPDKIKX0DER",
        sellerSku: "ASCL01",
        expiryDate: "2026-09-11",
        stopSaleDate: null,
        note: "先出舊批次",
      },
      {
        id: "promo-prime",
        type: "promotion",
        startDate: "2026-09-08",
        endDate: "2026-09-08",
        title: "Prime 大檔",
        note: "確認折扣與庫存",
        countdown: true,
      },
      {
        id: "promo-coupon",
        type: "promotion",
        startDate: "2026-09-21",
        endDate: "2026-09-21",
        title: "Coupon 更新",
        note: "例行維護",
        countdown: false,
      },
    ],
  },
  source: "shared",
  stale: false,
  status: "ready",
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

describe("operations bulletin home card", () => {
  it("uses date-only countdowns with explicit overdue and today copy", () => {
    expect(countdownPresentation("2026-09-11", "2026-09-01")).toEqual({
      days: 10,
      label: "倒數 10 天",
      state: "upcoming",
    });
    expect(countdownPresentation("2026-09-01", "2026-09-01")).toEqual({
      days: 0,
      label: "就是今天",
      state: "today",
    });
    expect(countdownPresentation("2026-08-29", "2026-09-01")).toEqual({
      days: -3,
      label: "已過期 3 天",
      state: "past",
    });
  });

  it("uses five Sunday-first calendar weeks when they fit and six only when needed", () => {
    const fiveWeekMonth = calendarMonthCells("2026-09");
    expect(fiveWeekMonth).toHaveLength(35);
    expect(fiveWeekMonth[0]).toBe("2026-08-30");
    expect(fiveWeekMonth[2]).toBe("2026-09-01");
    expect(fiveWeekMonth.at(-1)).toBe("2026-10-03");

    const shortMonth = calendarMonthCells("2026-02");
    expect(shortMonth).toHaveLength(35);
    expect(shortMonth[0]).toBe("2026-02-01");
    expect(shortMonth.at(-1)).toBe("2026-03-07");

    const sixWeekMonth = calendarMonthCells("2026-08");
    expect(sixWeekMonth).toHaveLength(42);
    expect(sixWeekMonth[0]).toBe("2026-07-26");
    expect(sixWeekMonth.at(-1)).toBe("2026-09-05");
  });

  it("migrates a fetched v1 board into the canonical one-day promotion view", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      snapshot: {
        schemaVersion: 1,
        revision: 3,
        updatedAt: "2026-09-01T00:00:00.000Z",
        items: [{
          id: "00000000-0000-4000-8000-000000000099",
          type: "promotion",
          date: "2026-09-08",
          title: "舊版單日促銷",
          note: "相容顯示",
          countdown: true,
        }],
      },
      source: "shared",
      stale: false,
      status: "ready",
    }), { status: 200, headers: { "content-type": "application/json" } })));
    vi.stubGlobal("window", { fbaOS: { operationsBoard: {} } });

    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(<OperationsBulletinCard todayDateKey="2026-09-01" />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const markup = JSON.stringify(renderer!.toJSON());
    expect(markup).toContain("舊版單日促銷");
    expect(markup).toContain("倒數 7 天");
    await act(async () => renderer!.unmount());
  });

  it("renders only the calendar week rows needed by the selected month", () => {
    const markup = renderToStaticMarkup(
      <OperationsBulletinCard
        initialResponse={BOARD}
        todayDateKey="2026-09-01"
      />,
    );
    const calendarBody = markup.slice(
      markup.indexOf("<tbody>"),
      markup.indexOf("</tbody>") + "</tbody>".length,
    );

    expect(calendarBody.match(/<tr>/gu)).toHaveLength(5);
  });

  it("rolls the live board over at Taipei midnight but keeps an injected date fixed", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T15:59:59.900Z"));
    expect(millisecondsUntilNextTaipeiDay(new Date())).toBe(100);
    vi.stubGlobal("window", { fbaOS: { operationsBoard: {} } });
    const promotion = BOARD.snapshot.items.find((item) => item.type === "promotion");
    if (!promotion || promotion.type !== "promotion") {
      throw new Error("promotion fixture missing");
    }
    const midnightBoard: OperationsBoardResponse = {
      ...BOARD,
      snapshot: {
        ...BOARD.snapshot,
        items: [{
          ...promotion,
          startDate: "2026-09-02",
          endDate: "2026-09-02",
          countdown: true,
        }],
      },
    };

    let liveRenderer: ReactTestRenderer | null = null;
    await act(async () => {
      liveRenderer = create(<OperationsBulletinCard initialResponse={midnightBoard} />);
      await Promise.resolve();
    });
    expect(JSON.stringify(liveRenderer!.toJSON())).toContain("倒數 1 天");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(JSON.stringify(liveRenderer!.toJSON())).toContain("就是今天");
    await act(async () => liveRenderer!.unmount());

    let injectedRenderer: ReactTestRenderer | null = null;
    await act(async () => {
      injectedRenderer = create(
        <OperationsBulletinCard
          initialResponse={midnightBoard}
          todayDateKey="2026-09-01"
        />,
      );
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(86_400_000);
    });
    expect(JSON.stringify(injectedRenderer!.toJSON())).toContain("倒數 1 天");
    expect(JSON.stringify(injectedRenderer!.toJSON())).not.toContain("就是今天");
    await act(async () => injectedRenderer!.unmount());
  });

  it("shows today as a single word instead of a misleading zero-day pair", () => {
    const todayBoard: OperationsBoardResponse = {
      ...BOARD,
      snapshot: {
        ...BOARD.snapshot,
        items: BOARD.snapshot.items.map((item) =>
          item.type === "expiry" ? { ...item, expiryDate: "2026-09-01" } : item
        ),
      },
    };
    const markup = renderToStaticMarkup(
      <OperationsBulletinCard
        initialResponse={todayBoard}
        todayDateKey="2026-09-01"
      />,
    );

    expect(markup).toContain('aria-label="就是今天"');
    expect(markup).toContain("<strong>今天</strong>");
    expect(markup).not.toContain("<strong>0</strong><span>今天</span>");
  });

  it("keeps a 25-SKU expiry board as one dense internally scrollable list", async () => {
    const expiry = BOARD.snapshot.items.find((item) => item.type === "expiry");
    if (!expiry || expiry.type !== "expiry") throw new Error("expiry fixture missing");
    const busyBoard: OperationsBoardResponse = {
      ...BOARD,
      snapshot: {
        ...BOARD.snapshot,
        items: Array.from({ length: 25 }, (_, index) => ({
          ...expiry,
          id: `expiry-${index}`,
          sellerSku: `DENSE-SKU-${String(index + 1).padStart(2, "0")}`,
        })),
      },
    };
    const markup = renderToStaticMarkup(
      <OperationsBulletinCard
        initialResponse={busyBoard}
        todayDateKey="2026-09-01"
      />,
    );
    const bulletinCss = await readFile(
      new URL("../src/renderer/src/styles/operations-bulletin.css", import.meta.url),
      "utf8",
    );

    expect(markup.match(/class="bulletin-expiry-item"/gu)).toHaveLength(25);
    expect(markup).not.toContain("人工維護效期");
    expect(markup).not.toContain("Amazon 公開 API 不提供目前 FBA 批次效期");
    expect(bulletinCss).toMatch(
      /\.bulletin-expiry-list\s*\{[\s\S]*?max-height:\s*520px;[\s\S]*?overflow-y:\s*auto;/u,
    );
    expect(bulletinCss).toMatch(
      /\.bulletin-countdown\s*\{[\s\S]*?min-height:\s*7\dpx;/u,
    );
    expect(bulletinCss).toMatch(
      /\.bulletin-countdown\s*\{[\s\S]*?align-self:\s*stretch;/u,
    );
    expect(bulletinCss).toMatch(
      /\.bulletin-expiry-item\s*\{[\s\S]*?grid-template-columns:\s*76px\s+minmax\(0,\s*1fr\);/u,
    );
  });

  it("keeps dense expiry cards readable without tiny operational text", async () => {
    const bulletinCss = await readFile(
      new URL("../src/renderer/src/styles/operations-bulletin.css", import.meta.url),
      "utf8",
    );

    expect(bulletinCss).toMatch(
      /\.bulletin-countdown small\s*\{[^}]*font-size:\s*10px;/u,
    );
    expect(bulletinCss).toMatch(
      /\.bulletin-countdown strong\s*\{[^}]*font-size:\s*28px;/u,
    );
    expect(bulletinCss).toMatch(
      /\.bulletin-countdown\s*>\s*span\s*\{[^}]*font-size:\s*11px;/u,
    );
    expect(bulletinCss).toMatch(
      /\.bulletin-manage\s*\{[^}]*font-size:\s*10px;/u,
    );
    expect(bulletinCss).toMatch(
      /\.bulletin-expiry-title-row small\s*\{[^}]*font-size:\s*10px;/u,
    );
    expect(bulletinCss).toMatch(
      /\.bulletin-expiry-title-row h4\s*\{[^}]*font-size:\s*14px;/u,
    );
    expect(bulletinCss).toMatch(
      /\.bulletin-expiry-meta\s*\{[^}]*font-size:\s*11px;/u,
    );
    expect(bulletinCss).toMatch(
      /\.bulletin-expiry-facts dt\s*\{[^}]*font-size:\s*10px;/u,
    );
    expect(bulletinCss).toMatch(
      /\.bulletin-expiry-facts dd\s*\{[^}]*font-size:\s*12px;/u,
    );
    expect(bulletinCss).toMatch(
      /\.bulletin-fact-sync\s*\{[^}]*font-size:\s*10px;/u,
    );
  });

  it("keeps a 100-entry monthly agenda inside a labelled scroll region", async () => {
    const promotion = BOARD.snapshot.items.find((item) => item.type === "promotion");
    if (!promotion || promotion.type !== "promotion") {
      throw new Error("promotion fixture missing");
    }
    const busyBoard: OperationsBoardResponse = {
      ...BOARD,
      snapshot: {
        ...BOARD.snapshot,
        items: Array.from({ length: 100 }, (_, index) => ({
          ...promotion,
          id: `promotion-${index}`,
          startDate: `2026-09-${String((index % 28) + 1).padStart(2, "0")}`,
          endDate: `2026-09-${String((index % 28) + 1).padStart(2, "0")}`,
          title: `PROMOTION-${String(index + 1).padStart(3, "0")}`,
        })),
      },
    };
    const markup = renderToStaticMarkup(
      <OperationsBulletinCard
        initialResponse={busyBoard}
        todayDateKey="2026-09-01"
      />,
    );
    const bulletinCss = await readFile(
      new URL("../src/renderer/src/styles/operations-bulletin.css", import.meta.url),
      "utf8",
    );

    expect(markup.match(/data-entry-kind="promotion"/gu)).toHaveLength(100);
    expect(markup).toContain(
      'class="bulletin-calendar-agenda" role="region" aria-label="2026 年 9 月完整營運日程" tabindex="0"',
    );
    expect(bulletinCss).toMatch(
      /\.bulletin-calendar-agenda\s*\{[\s\S]*?max-height:\s*360px;[\s\S]*?overflow-y:\s*auto;/u,
    );
  });

  it("labels identical expiry SKUs with their marketplace in rows and calendar entries", () => {
    const expiry = BOARD.snapshot.items.find((item) => item.type === "expiry");
    if (!expiry || expiry.type !== "expiry") throw new Error("expiry fixture missing");
    const sharedSkuBoard: OperationsBoardResponse = {
      ...BOARD,
      snapshot: {
        ...BOARD.snapshot,
        items: [
          { ...expiry, id: "expiry-us", sellerSku: "SHARED-SKU" },
          {
            ...expiry,
            id: "expiry-ca",
            marketplaceId: "A2EUQ1WTGCTBG2",
            sellerSku: "SHARED-SKU",
          },
        ],
      },
    };
    const markup = renderToStaticMarkup(
      <OperationsBulletinCard
        initialResponse={sharedSkuBoard}
        todayDateKey="2026-09-01"
      />,
    );

    expect(markup).toContain('class="bulletin-marketplace-code">US</span>');
    expect(markup).toContain('class="bulletin-marketplace-code">CA</span>');
    expect(markup).toContain("US · SHARED-SKU 到期");
    expect(markup).toContain("CA · SHARED-SKU 到期");
  });

  it("is expanded by default and distinguishes manual expiry from promotion dates", () => {
    const markup = renderToStaticMarkup(
      <OperationsBulletinCard
        initialResponse={BOARD}
        todayDateKey="2026-09-01"
      />,
    );

    expect(markup).toContain('<details class="operations-bulletin" open=""');
    expect(markup).toContain("營運公布欄");
    expect(markup).toContain('class="operations-bulletin-icon"');
    expect(markup).toContain("<svg");
    expect(markup).not.toContain('class="operations-bulletin-mark"');
    expect(markup).toContain("即期品倒數");
    expect(markup).not.toContain("人工維護效期");
    expect(markup).toContain("ASCL01");
    expect(markup).toContain("2026 年 9 月 11 日");
    expect(markup).toContain("倒數 10 天");
    expect(markup).toContain("US · ASCL01 到期");
    expect(markup).toContain("2026 年 9 月 11 日（週五）的營運公告");
    expect(markup).toContain("促銷月曆");
    expect(markup).toContain("Prime 大檔");
    expect(markup).toContain("倒數 7 天");
    expect(markup).toContain("Coupon 更新");
    expect(markup).toContain("新增即期品");
    expect(markup).toContain("新增促銷");
    expect(markup).not.toContain("登入並更新公布欄");
    expect(markup).toContain("目前庫存同步中");
    expect(markup).toContain("目前價格同步中");
    expect(markup).toContain("<colgroup>");

    const expiryItem = markup.slice(
      markup.indexOf('class="bulletin-expiry-item"'),
      markup.indexOf("</article>", markup.indexOf('class="bulletin-expiry-item"')),
    );
    expect(expiryItem.match(/倒數 10 天/gu)).toHaveLength(1);
    expect(expiryItem).not.toContain("<em>");

    const nonCountdownPromotion = markup.slice(
      markup.indexOf("Coupon 更新"),
      markup.indexOf("Coupon 更新") + 500,
    );
    expect(nonCountdownPromotion).not.toContain("倒數");
  });

  it("prioritizes stop-sale countdowns and paints every day of a promotion range", () => {
    const v2Board = {
      ...BOARD,
      snapshot: {
        ...BOARD.snapshot,
        schemaVersion: 2,
        items: [
          {
            id: "expiry-stop-sale",
            type: "expiry",
            marketplaceId: "ATVPDKIKX0DER",
            sellerSku: "ASCL01",
            expiryDate: "2026-09-11",
            stopSaleDate: "2026-09-04",
            note: "先停售再出清",
          },
          {
            id: "promotion-range",
            type: "promotion",
            startDate: "2026-09-08",
            endDate: "2026-09-10",
            title: "Prime 三日檔",
            note: "連續三天",
            countdown: true,
          },
        ],
      },
    } as unknown as OperationsBoardResponse;
    const markup = renderToStaticMarkup(
      <OperationsBulletinCard initialResponse={v2Board} todayDateKey="2026-09-01" />,
    );
    const expiryCard = markup.slice(
      markup.indexOf('class="bulletin-expiry-item"'),
      markup.indexOf("</article>", markup.indexOf('class="bulletin-expiry-item"')),
    );

    expect(expiryCard).toContain("距離停售");
    expect(expiryCard).toContain("倒數 3 天");
    expect(expiryCard).toMatch(/停售日[\s\S]*2026 年 9 月 4 日/u);
    expect(expiryCard).toMatch(/效期[\s\S]*2026 年 9 月 11 日/u);
    expect(markup).toContain("US · ASCL01 停售");
    expect(markup).toContain("US · ASCL01 到期");
    expect(markup).toContain("倒數 7 天");

    const calendarBody = markup.slice(
      markup.indexOf("<tbody>"),
      markup.indexOf("</tbody>") + "</tbody>".length,
    );
    for (const date of ["2026-09-08", "2026-09-09", "2026-09-10"]) {
      const marker = `<time dateTime="${date}">`;
      const markerIndex = calendarBody.indexOf(marker);
      const cellEnd = calendarBody.indexOf("</td>", markerIndex);
      expect(markerIndex, date).toBeGreaterThan(-1);
      expect(calendarBody.slice(markerIndex, cellEnd), date).toContain("Prime 三日檔");
    }

    const activeMarkup = renderToStaticMarkup(
      <OperationsBulletinCard initialResponse={v2Board} todayDateKey="2026-09-09" />,
    );
    expect(activeMarkup).toContain("進行中");
    const endedMarkup = renderToStaticMarkup(
      <OperationsBulletinCard initialResponse={v2Board} todayDateKey="2026-09-11" />,
    );
    expect(endedMarkup).toContain("已結束 1 天");
  });

  it("uses one custom date-picker button instead of a native editable date input", () => {
    const markup = renderToStaticMarkup(
      <OperationsBulletinCard initialResponse={BOARD} todayDateKey="2026-09-15" />,
    );
    const navigation = markup.slice(
      markup.indexOf('class="bulletin-calendar-navigation"'),
      markup.indexOf("</div>", markup.indexOf('class="bulletin-calendar-navigation"')),
    );

    expect(navigation).not.toContain("查看上個月");
    expect(navigation).not.toContain("查看下個月");
    expect(navigation).toContain('aria-label="選擇月曆日期"');
    expect(navigation).not.toContain('type="date"');
    expect(navigation).not.toContain("2023");
    expect(navigation.match(/<button/gu)).toHaveLength(1);
  });

  it("opens on month selection, offers only the surrounding three years, then selects a day", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("window", { fbaOS: { operationsBoard: { schemaVersion: 2 } } });

    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        <OperationsBulletinCard initialResponse={BOARD} todayDateKey="2026-09-15" />,
      );
    });
    const calendarButton = renderer!.root.findByProps({
      "aria-label": "選擇月曆日期",
    });
    await act(async () => calendarButton.props.onClick());

    const monthDialog = renderer!.root.findByProps({
      "aria-label": "選擇月曆日期：先選月份",
    });
    const monthMarkup = JSON.stringify(renderer!.toJSON());
    expect(monthMarkup).toContain("2025");
    expect(monthMarkup).toContain("2026");
    expect(monthMarkup).toContain("2027");
    expect(monthMarkup).not.toContain("2023");
    expect(monthMarkup).toContain("先選月份");
    expect(monthDialog.findAllByProps({
      "aria-label": "選擇 2026 年 9 月 15 日",
    })).toHaveLength(0);

    await act(async () => renderer!.root.findByProps({
      "aria-label": "選擇 2027 年",
    }).props.onClick());
    await act(async () => renderer!.root.findByProps({
      "aria-label": "選擇 2027 年 4 月",
    }).props.onClick());
    expect(renderer!.root.findByProps({
      "aria-label": "選擇月曆日期：再選日期",
    })).toBeTruthy();
    await act(async () => renderer!.root.findByProps({
      "aria-label": "選擇 2027 年 4 月 30 日",
    }).props.onClick());
    expect(JSON.stringify(renderer!.toJSON())).toContain("2027 年 4 月");
    const selectedDay = renderer!.root.findByProps({ dateTime: "2027-04-30" });
    expect(selectedDay.parent?.props.className).toContain("is-selected");
    await act(async () => renderer!.unmount());
  });

  it("renders stale and unavailable states as text rather than color-only signals", () => {
    const staleMarkup = renderToStaticMarkup(
      <OperationsBulletinCard
        initialResponse={{ ...BOARD, source: "last-known-good", stale: true }}
        todayDateKey="2026-09-01"
      />,
    );
    expect(staleMarkup).toContain("目前顯示上次同步資料");

    const unavailableMarkup = renderToStaticMarkup(
      <OperationsBulletinCard
        initialResponse={{
          snapshot: {
            schemaVersion: 2,
            revision: 0,
            updatedAt: "2026-09-01T00:00:00.000Z",
            items: [],
          },
          source: "empty",
          stale: false,
          status: "not-configured",
          message: "尚未設定共用公布欄。",
        }}
        todayDateKey="2026-09-01"
      />,
    );
    expect(unavailableMarkup).toContain("尚未設定共用公布欄");
    expect(unavailableMarkup).toContain("尚未公布即期品或促銷檔期");
    expect(unavailableMarkup).toContain("尚未發布");
    expect(unavailableMarkup).not.toContain("1970");
  });

  it("loads expiry facts in one narrow batch and opens a plain-language prefilled publisher", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const publish = vi.fn(async () => undefined);
    const manage = vi.fn(async () => undefined);
    let notifyUpdated: (() => void) | null = null;
    const stopListening = vi.fn();
    const onUpdated = vi.fn((listener: () => void) => {
      notifyUpdated = listener;
      return stopListening;
    });
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/sp-api/operations-board-facts") {
        expect(init).toMatchObject({ method: "POST", cache: "no-store" });
        return new Response(JSON.stringify({
          facts: [{
            id: "expiry-ASCL01",
            marketplaceId: "ATVPDKIKX0DER",
            sellerSku: "ASCL01",
            mode: "live",
            fetchedAt: "2026-09-01T03:00:00.000Z",
            price: {
              state: "ready",
              value: { amount: 18.99, currencyCode: "USD" },
            },
            inventory: { state: "ready", value: 12 },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "/api/operations-board") {
        return new Response(JSON.stringify(BOARD), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", request);
    vi.stubGlobal("window", {
      fbaOS: { operationsBoard: { schemaVersion: 2, publish, manage, onUpdated } },
    });

    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        <OperationsBulletinCard
          initialResponse={BOARD}
          todayDateKey="2026-09-01"
        />,
      );
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const text = renderer!.toJSON();
    expect(JSON.stringify(text)).toContain("12 件");
    expect(JSON.stringify(text)).toContain("18.99");
    const sync = renderer!.root.findByProps({ className: "bulletin-fact-sync" });
    expect(sync.children.join("")).toMatch(/同步[\s\u2009]+2026\/09\/01[\s\u2009]+11:00/u);
    expect(request.mock.calls.filter(([url]) =>
      url === "/api/sp-api/operations-board-facts"
    )).toHaveLength(1);
    expect(request.mock.calls.some(([url]) => String(url).includes("sku-command"))).toBe(false);

    const addExpiry = renderer!.root.findAllByType("button").find((button) =>
      button.children.join("").includes("新增即期品")
    );
    expect(addExpiry).toBeDefined();
    await act(async () => {
      await addExpiry!.props.onClick();
    });
    const expiryComposerMarkup = JSON.stringify(renderer!.toJSON());
    expect(expiryComposerMarkup).toContain("登入並確認發布");
    expect(expiryComposerMarkup).toContain(
      "公告只會公開 SKU、日期與備註；Amazon 庫存、價格與憑證不會上傳。",
    );
    expect(expiryComposerMarkup).not.toContain("GitHub");
    const field = (name: string) => renderer!.root.findByProps({ name });
    await act(async () => {
      field("sellerSku").props.onChange({ currentTarget: { value: "NEW-SKU" } });
      field("expiryDate").props.onChange({ currentTarget: { value: "2026-12-31" } });
      field("stopSaleDate").props.onChange({ currentTarget: { value: "2026-11-30" } });
      field("note").props.onChange({ currentTarget: { value: "先出舊批次" } });
    });
    const form = renderer!.root.findByProps({ "aria-label": "新增即期品公告" });
    await act(async () => {
      await form.props.onSubmit({ preventDefault: vi.fn() });
    });
    expect(publish).toHaveBeenCalledWith({
      type: "expiry",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "NEW-SKU",
      expiryDate: "2026-12-31",
      stopSaleDate: "2026-11-30",
      note: "先出舊批次",
    });
    expect(request.mock.calls.filter(([url]) => url === "/api/operations-board"))
      .toHaveLength(0);
    expect(onUpdated).toHaveBeenCalledOnce();
    await act(async () => {
      notifyUpdated?.();
      await Promise.resolve();
    });
    expect(request.mock.calls.filter(([url]) => url === "/api/operations-board"))
      .toHaveLength(1);

    await act(async () => renderer!.unmount());
    expect(stopListening).toHaveBeenCalledOnce();
  });

  it("labels demo inventory and price as display data instead of Amazon current values", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      facts: [{
        id: "expiry-ASCL01",
        marketplaceId: "ATVPDKIKX0DER",
        sellerSku: "ASCL01",
        mode: "demo",
        fetchedAt: "2026-09-01T03:00:00.000Z",
        price: { state: "ready", value: { amount: 18.99, currencyCode: "USD" } },
        inventory: { state: "ready", value: 12 },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } })));
    vi.stubGlobal("window", { fbaOS: { operationsBoard: {} } });

    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        <OperationsBulletinCard initialResponse={BOARD} todayDateKey="2026-09-01" />,
      );
      await Promise.resolve();
    });
    await act(async () => await Promise.resolve());
    const markup = JSON.stringify(renderer!.toJSON());
    expect(markup).toContain("展示庫存");
    expect(markup).toContain("展示價格");
    expect(markup).toContain("展示資料");
    expect(markup).not.toContain("Amazon 即時資料同步於");
    await act(async () => renderer!.unmount());
  });

  it("publishes promotions with one countdown choice and opens edit/delete", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const publish = vi.fn(async () => undefined);
    const manage = vi.fn(async () => undefined);
    vi.stubGlobal("window", {
      fbaOS: { operationsBoard: { schemaVersion: 2, publish, manage } },
    });
    const promotion = BOARD.snapshot.items.find((item) => item.type === "promotion");
    if (!promotion || promotion.type !== "promotion") {
      throw new Error("promotion fixture missing");
    }
    const board: OperationsBoardResponse = {
      ...BOARD,
      snapshot: {
        ...BOARD.snapshot,
        items: [{
          ...promotion,
          id: "00000000-0000-4000-8000-000000000123",
        }],
      },
    };

    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        <OperationsBulletinCard initialResponse={board} todayDateKey="2026-09-01" />,
      );
    });
    const addPromotion = renderer!.root.findAllByType("button").find((button) =>
      button.children.join("").includes("新增促銷")
    );
    await act(async () => addPromotion!.props.onClick());
    const promotionComposerMarkup = JSON.stringify(renderer!.toJSON());
    expect(promotionComposerMarkup).toContain("登入並確認發布");
    expect(promotionComposerMarkup).not.toContain('"type":"date"');
    expect(promotionComposerMarkup).toContain("選擇促銷開始日");
    expect(promotionComposerMarkup).toContain("選擇促銷結束日");
    expect(promotionComposerMarkup).toContain(
      "公告只會公開促銷名稱、日期與備註；Amazon 庫存、價格與憑證不會上傳。",
    );
    expect(promotionComposerMarkup).not.toContain("GitHub");
    const field = (name: string) => renderer!.root.findByProps({ name });
    const dateButton = (name: string) => renderer!.root
      .findAllByProps({ name })
      .find((node) => node.type === "button")!;
    await act(async () => {
      field("promotionTitle").props.onChange({ currentTarget: { value: "尚未選日期" } });
      await renderer!.root.findByProps({ "aria-label": "新增促銷公告" })
        .props.onSubmit({ preventDefault: vi.fn() });
    });
    expect(publish).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer!.toJSON())).toContain("請先選擇促銷開始日。");
    await act(async () => {
      dateButton("promotionStartDate").props.onClick();
    });
    await act(async () => renderer!.root.findByProps({
      "aria-label": "選擇 2026 年 10 月",
    }).props.onClick());
    await act(async () => renderer!.root.findByProps({
      "aria-label": "選擇 2026 年 10 月 13 日",
    }).props.onClick());
    await act(async () => {
      dateButton("promotionEndDate").props.onClick();
    });
    await act(async () => renderer!.root.findByProps({
      "aria-label": "選擇 2026 年 10 月",
    }).props.onClick());
    await act(async () => renderer!.root.findByProps({
      "aria-label": "選擇 2026 年 10 月 15 日",
    }).props.onClick());
    await act(async () => {
      dateButton("promotionEndDate").props.onClick();
    });
    await act(async () => renderer!.root.findByProps({
      "aria-label": "清除促銷結束日",
    }).props.onClick());
    expect(dateButton("promotionEndDate").findByType("strong").children.join(""))
      .toBe("選擇日期");
    await act(async () => {
      dateButton("promotionEndDate").props.onClick();
    });
    await act(async () => renderer!.root.findByProps({
      "aria-label": "選擇 2026 年 10 月",
    }).props.onClick());
    await act(async () => renderer!.root.findByProps({
      "aria-label": "選擇 2026 年 10 月 15 日",
    }).props.onClick());
    await act(async () => {
      field("promotionTitle").props.onChange({ currentTarget: { value: "Prime 大檔" } });
      field("promotionNote").props.onChange({ currentTarget: { value: "確認折扣" } });
      field("countdown").props.onChange({ currentTarget: { checked: true } });
    });
    await act(async () => {
      await renderer!.root.findByProps({ "aria-label": "新增促銷公告" })
        .props.onSubmit({ preventDefault: vi.fn() });
    });
    expect(publish).toHaveBeenCalledWith({
      type: "promotion",
      startDate: "2026-10-13",
      endDate: "2026-10-15",
      title: "Prime 大檔",
      note: "確認折扣",
      countdown: true,
    });

    const addPromotionAgain = renderer!.root.findAllByType("button").find((button) =>
      button.children.join("").includes("新增促銷")
    );
    await act(async () => addPromotionAgain!.props.onClick());
    expect(dateButton("promotionStartDate").findByType("strong").children.join(""))
      .toBe("選擇日期");
    expect(dateButton("promotionEndDate").findByType("strong").children.join(""))
      .toBe("選擇日期");
    await act(async () => renderer!.root.findByProps({
      "aria-label": "關閉新增促銷表單",
    }).props.onClick());

    const manageButton = renderer!.root.findAllByProps({ className: "bulletin-manage" })[0];
    expect(manageButton.children.join("")).toBe("編輯／刪除");
    await act(async () => manageButton.props.onClick());
    expect(manage).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000123",
    );
    await act(async () => renderer!.unmount());
  });

  it("keeps legacy Notebook Keys read-only and explains the one-time update", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const publish = vi.fn(async () => undefined);
    const manage = vi.fn(async () => undefined);
    vi.stubGlobal("window", {
      fbaOS: { operationsBoard: { publish, manage } },
    });

    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        <OperationsBulletinCard initialResponse={BOARD} todayDateKey="2026-09-01" />,
      );
    });

    const addExpiry = renderer!.root.findAllByType("button").find((button) =>
      button.children.join("").includes("新增即期品")
    );
    await act(async () => addExpiry!.props.onClick());
    expect(renderer!.root.findAllByProps({ "aria-label": "新增即期品公告" }))
      .toHaveLength(0);
    expect(JSON.stringify(renderer!.toJSON())).toContain(
      "新增停售日與多日促銷需要 AMZ.API App 0.1.53；請更新一次後再發布。",
    );
    expect(publish).not.toHaveBeenCalled();

    const manageButton = renderer!.root.findAllByProps({ className: "bulletin-manage" })[0];
    await act(async () => manageButton.props.onClick());
    expect(manage).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer!.toJSON())).toContain(
      "編輯或刪除新版公布欄需要 AMZ.API App 0.1.53；請更新一次後再操作。",
    );

    await act(async () => renderer!.unmount());
  });

  it("explains a failed publish without exposing the backing service", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const publish = vi.fn(async () => Promise.reject(null));
    vi.stubGlobal("window", {
      fbaOS: { operationsBoard: { schemaVersion: 2, publish } },
    });
    const emptyBoard: OperationsBoardResponse = {
      ...BOARD,
      snapshot: { ...BOARD.snapshot, items: [] },
    };

    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        <OperationsBulletinCard initialResponse={emptyBoard} todayDateKey="2026-09-01" />,
      );
    });
    const addExpiry = renderer!.root.findAllByType("button").find((button) =>
      button.children.join("").includes("新增即期品")
    );
    await act(async () => addExpiry!.props.onClick());
    await act(async () => {
      renderer!.root.findByProps({ name: "sellerSku" }).props
        .onChange({ currentTarget: { value: "NEW-SKU" } });
      renderer!.root.findByProps({ name: "expiryDate" }).props
        .onChange({ currentTarget: { value: "2026-12-31" } });
    });
    await act(async () => {
      await renderer!.root.findByProps({ "aria-label": "新增即期品公告" })
        .props.onSubmit({ preventDefault: vi.fn() });
    });

    const markup = JSON.stringify(renderer!.toJSON());
    expect(markup).toContain("目前無法登入或開啟發布確認。");
    expect(markup).not.toContain("GitHub");
    await act(async () => renderer!.unmount());
  });

  it("uses direct edit and delete language when announcement management fails", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const manage = vi.fn(async () => Promise.reject(null));
    vi.stubGlobal("window", {
      fbaOS: { operationsBoard: { schemaVersion: 2, manage } },
    });

    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        <OperationsBulletinCard initialResponse={BOARD} todayDateKey="2026-09-01" />,
      );
      await Promise.resolve();
    });
    const manageButton = renderer!.root.findAllByProps({ className: "bulletin-manage" })[0];
    expect(manageButton.children.join("")).toBe("編輯／刪除");
    await act(async () => manageButton.props.onClick());

    expect(JSON.stringify(renderer!.toJSON())).toContain("目前無法開啟編輯／刪除。");
    await act(async () => renderer!.unmount());
  });

  it("keeps both publisher forms rendered after React releases every input event", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("window", {
      fbaOS: {
        operationsBoard: {
          schemaVersion: 2,
          publish: vi.fn(async () => undefined),
          manage: vi.fn(async () => undefined),
        },
      },
    });
    const emptyBoard: OperationsBoardResponse = {
      ...BOARD,
      snapshot: { ...BOARD.snapshot, items: [] },
    };

    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        <OperationsBulletinCard
          initialResponse={emptyBoard}
          todayDateKey="2026-09-01"
        />,
      );
    });

    const buttonWithText = (label: string) =>
      renderer!.root.findAllByType("button").find((button) =>
        button.children.join("").includes(label)
      );
    const changeValue = async (name: string, value: string) => {
      const inputEvent: { currentTarget: { value: string } | null } = {
        currentTarget: { value },
      };
      await act(async () => {
        renderer!.root.findByProps({ name }).props.onChange(inputEvent);
        inputEvent.currentTarget = null;
        await Promise.resolve();
      });
      expect(renderer!.root.findByProps({ name }).props.value).toBe(value);
    };
    const pickDate = async (name: string, year: number, month: number, day: number) => {
      const button = renderer!.root.findAllByProps({ name })
        .find((node) => node.type === "button")!;
      await act(async () => button.props.onClick());
      await act(async () => renderer!.root.findByProps({
        "aria-label": `選擇 ${year} 年 ${month} 月`,
      }).props.onClick());
      await act(async () => renderer!.root.findByProps({
        "aria-label": `選擇 ${year} 年 ${month} 月 ${day} 日`,
      }).props.onClick());
      expect(JSON.stringify(renderer!.toJSON())).toContain(
        `${year} 年 ${month} 月 ${day} 日`,
      );
    };
    await act(async () => buttonWithText("新增即期品")!.props.onClick());
    await changeValue("marketplaceId", "A1F83G8C2ARO7P");
    await changeValue("sellerSku", "NEW-SKU");
    await changeValue("expiryDate", "2026-12-31");
    await changeValue("note", "先出舊批次");

    await act(async () => {
      renderer!.root.findByProps({ "aria-label": "關閉新增即期品表單" })
        .props.onClick();
      buttonWithText("新增促銷")!.props.onClick();
    });
    await pickDate("promotionStartDate", 2026, 10, 13);
    await pickDate("promotionEndDate", 2026, 10, 15);
    await changeValue("promotionTitle", "Prime 大檔");
    await changeValue("promotionNote", "確認折扣");
    const promotionEvent: { currentTarget: { checked: boolean } | null } = {
      currentTarget: { checked: true },
    };
    await act(async () => {
      renderer!.root.findByProps({ name: "countdown" }).props
        .onChange(promotionEvent);
      promotionEvent.currentTarget = null;
      await Promise.resolve();
    });
    expect(renderer!.root.findByProps({ name: "countdown" }).props.checked)
      .toBe(true);

    await act(async () => renderer!.unmount());
  });

  it("keeps the manual countdown visible when Amazon price and inventory fail", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ message: "Amazon 暫時無法查詢。" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      })
    ));
    vi.stubGlobal("window", { fbaOS: { operationsBoard: { openEditor: vi.fn() } } });

    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        <OperationsBulletinCard
          initialResponse={BOARD}
          todayDateKey="2026-09-01"
        />,
      );
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const markup = JSON.stringify(renderer!.toJSON());
    expect(markup).toContain("倒數 10 天");
    expect(markup.match(/無法取得/gu)).toHaveLength(3);
    await act(async () => renderer!.unmount());
  });

  it("keeps the bulletin responsive, foldable, and visibly keyboard focused", async () => {
    const [css, bulletinCss] = await Promise.all([
      readRendererStylesheet(),
      readFile(
        new URL("../src/renderer/src/styles/operations-bulletin.css", import.meta.url),
        "utf8",
      ),
    ]);
    expect(css).toMatch(/\.operations-bulletin\s*>\s*summary:focus-visible\s*\{/u);
    expect(css).toMatch(/\.operations-bulletin-layout\s*\{[\s\S]*?grid-template-columns:/u);
    expect(css).toMatch(
      /@media \(max-width: 820px\)[\s\S]*?\.operations-bulletin-layout\s*\{[\s\S]*?grid-template-columns:\s*1fr;/u,
    );
    expect(bulletinCss).toMatch(
      /\.bulletin-calendar\s*\{[\s\S]*?table-layout:\s*fixed;/u,
    );
    expect(bulletinCss).toMatch(
      /\.bulletin-calendar col\s*\{[\s\S]*?width:\s*14\.285/u,
    );
    expect(bulletinCss).toMatch(
      /\.bulletin-calendar th:nth-child\(n\)\s*\{[\s\S]*?width:\s*14\.285/u,
    );
    expect(bulletinCss).toMatch(
      /\.bulletin-countdown\s*\{[\s\S]*?min-height:\s*7\dpx;/u,
    );
    expect(bulletinCss).not.toMatch(/#fff7e8|#fffaf1|#fff4de|#8d672e/iu);
  });
});
