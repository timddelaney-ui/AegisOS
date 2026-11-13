import React, { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("axios", () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

import axios from "axios";
import { toast } from "sonner";
import StringHistoryImport from "../StringHistoryImport";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("StringHistoryImport", () => {
  test("rejects stations outside the selected reel before posting", async () => {
    axios.get.mockResolvedValue({ data: { spacing_ft: 100 } });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<StringHistoryImport reel={{ reel_id: "R1", total_length_ft: 1000 }} />));

    const file = new File(["depth,damage\n5000,0.5\n6000,0.75\n"], "history.csv");
    file.text = jest.fn().mockResolvedValue("depth,damage\n5000,0.5\n6000,0.75\n");
    const input = host.querySelector('input[type="file"]');
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      host.querySelector("button").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.post).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/exceeds this reel/));
    act(() => root.unmount());
    host.remove();
  });
});
