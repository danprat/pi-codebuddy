import { describe, expect, it } from "bun:test";
import plugin from "../src/index.js";
import { getActiveRegion, setActiveRegion } from "../src/client/config.js";

describe("Extension Entry Point & Commands", () => {
  it("registers provider and commands with Pi ExtensionAPI", async () => {
    let registeredProviderId = "";
    let registeredProviderConfig: any = null;
    const commands: Record<string, any> = {};

    const fakePi: any = {
      registerProvider: (id: string, config: any) => {
        registeredProviderId = id;
        registeredProviderConfig = config;
      },
      registerCommand: (name: string, def: any) => {
        commands[name] = def;
      },
      on: () => {},
    };

    plugin(fakePi);

    expect(registeredProviderId).toBe("codebuddy");
    expect(registeredProviderConfig).toBeDefined();
    expect(registeredProviderConfig.name).toBe("CodeBuddy");
    expect(registeredProviderConfig.models.length).toBeGreaterThan(10);
    expect(registeredProviderConfig.oauth).toBeDefined();
    expect(typeof registeredProviderConfig.streamSimple).toBe("function");

    // Check commands registered
    expect(commands["codebuddy.usage"]).toBeDefined();
    expect(commands["codebuddy.models"]).toBeDefined();
    expect(commands["codebuddy.region"]).toBeDefined();
    expect(commands["codebuddy.accounts"]).toBeDefined();
    expect(commands["codebuddy.doctor"]).toBeDefined();
    expect(commands["codebuddy.refresh"]).toBeDefined();
  });

  it("handles /codebuddy.region toggle command", async () => {
    const commands: Record<string, any> = {};
    const fakePi: any = {
      registerProvider: () => {},
      registerCommand: (name: string, def: any) => {
        commands[name] = def;
      },
      on: () => {},
    };

    plugin(fakePi);

    let output = "";
    const fakeCtx: any = {
      hasUI: false,
      ui: { notify: () => {} },
    };

    // Switch to cn
    await commands["codebuddy.region"].handler("cn", {
      ...fakeCtx,
      hasUI: true,
      ui: {
        notify: (msg: string) => {
          output = msg;
        },
      },
    });

    expect(output).toContain("CN");
    expect(getActiveRegion()).toBe("cn");

    // Switch back to intl
    await commands["codebuddy.region"].handler("intl", {
      ...fakeCtx,
      hasUI: true,
      ui: {
        notify: (msg: string) => {
          output = msg;
        },
      },
    });

    expect(output).toContain("International");
    expect(getActiveRegion()).toBe("intl");
  });

  it("handles /codebuddy.doctor diagnostic command", async () => {
    const commands: Record<string, any> = {};
    const fakePi: any = {
      registerProvider: () => {},
      registerCommand: (name: string, def: any) => {
        commands[name] = def;
      },
      on: () => {},
    };

    plugin(fakePi);

    let output = "";
    const fakeCtx: any = {
      hasUI: true,
      ui: {
        notify: (msg: string) => {
          output = msg;
        },
      },
    };

    await commands["codebuddy.doctor"].handler("", fakeCtx);
    expect(output).toContain("CodeBuddy Doctor Diagnostics");
    expect(output).toContain("provider=codebuddy");
    expect(output).toContain("endpoint=");
  });
});
