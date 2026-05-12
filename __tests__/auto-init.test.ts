import { tryAutoInit } from "../src/auto-init";

function withCurrentScript(attrs: Record<string, string>, fn: () => void): void {
  const script = document.createElement("script");
  for (const [k, v] of Object.entries(attrs)) script.setAttribute(k, v);
  // jsdom doesn't set document.currentScript on appendChild; stub it.
  Object.defineProperty(document, "currentScript", {
    configurable: true,
    value: script,
  });
  try {
    fn();
  } finally {
    Object.defineProperty(document, "currentScript", {
      configurable: true,
      value: null,
    });
  }
}

describe("auto-init.tryAutoInit", () => {
  test("no-op when currentScript is null (ESM consumer path)", () => {
    Object.defineProperty(document, "currentScript", {
      configurable: true,
      value: null,
    });
    const init = jest.fn();
    const identify = jest.fn();
    tryAutoInit(init, identify);
    expect(init).not.toHaveBeenCalled();
    expect(identify).not.toHaveBeenCalled();
  });

  test("no-op when data-vektis-key is missing", () => {
    withCurrentScript({}, () => {
      const init = jest.fn();
      const identify = jest.fn();
      tryAutoInit(init, identify);
      expect(init).not.toHaveBeenCalled();
      expect(identify).not.toHaveBeenCalled();
    });
  });

  test("no-op when data-vektis-key is empty/whitespace", () => {
    withCurrentScript({ "data-vektis-key": "   " }, () => {
      const init = jest.fn();
      const identify = jest.fn();
      tryAutoInit(init, identify);
      expect(init).not.toHaveBeenCalled();
    });
  });

  test("calls init with only apiKey when other attributes absent", () => {
    withCurrentScript({ "data-vektis-key": "vk_pub_prd_abc" }, () => {
      const init = jest.fn();
      const identify = jest.fn();
      tryAutoInit(init, identify);
      expect(init).toHaveBeenCalledTimes(1);
      expect(init).toHaveBeenCalledWith({ apiKey: "vk_pub_prd_abc" });
      expect(identify).not.toHaveBeenCalled();
    });
  });

  test("forwards data-vektis-endpoint and data-vektis-debug to init", () => {
    withCurrentScript(
      {
        "data-vektis-key": "vk_pub_prd_abc",
        "data-vektis-endpoint": "https://preview-events.vektis.io/api/v1/events",
        "data-vektis-debug": "true",
      },
      () => {
        const init = jest.fn();
        tryAutoInit(init, jest.fn());
        expect(init).toHaveBeenCalledWith({
          apiKey: "vk_pub_prd_abc",
          endpoint: "https://preview-events.vektis.io/api/v1/events",
          debug: true,
        });
      }
    );
  });

  test('data-vektis-debug="false" sets debug=false', () => {
    withCurrentScript(
      { "data-vektis-key": "vk_pub_prd_abc", "data-vektis-debug": "false" },
      () => {
        const init = jest.fn();
        tryAutoInit(init, jest.fn());
        expect(init).toHaveBeenCalledWith(
          expect.objectContaining({ debug: false })
        );
      }
    );
  });

  test("data-vektis-customer-id triggers identify with customer_id only", () => {
    withCurrentScript(
      { "data-vektis-key": "vk_pub_prd_abc", "data-vektis-customer-id": "cust_x" },
      () => {
        const init = jest.fn();
        const identify = jest.fn();
        tryAutoInit(init, identify);
        expect(init).toHaveBeenCalled();
        expect(identify).toHaveBeenCalledWith({ customer_id: "cust_x" });
      }
    );
  });

  test("data-vektis-user-id is included on identify when customer-id is present", () => {
    withCurrentScript(
      {
        "data-vektis-key": "vk_pub_prd_abc",
        "data-vektis-customer-id": "cust_x",
        "data-vektis-user-id": "user_42",
      },
      () => {
        const identify = jest.fn();
        tryAutoInit(jest.fn(), identify);
        expect(identify).toHaveBeenCalledWith({
          customer_id: "cust_x",
          user_id: "user_42",
        });
      }
    );
  });

  test("data-vektis-user-id without customer-id does NOT call identify", () => {
    withCurrentScript(
      { "data-vektis-key": "vk_pub_prd_abc", "data-vektis-user-id": "user_42" },
      () => {
        const init = jest.fn();
        const identify = jest.fn();
        tryAutoInit(init, identify);
        expect(init).toHaveBeenCalled();
        expect(identify).not.toHaveBeenCalled();
      }
    );
  });
});
