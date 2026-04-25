import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  PresentationModeProvider,
  usePresentationMode,
} from "../components/providers/PresentationModeProvider";

function TestConsumer() {
  const { isPresenting, toggle } = usePresentationMode();
  return (
    <div>
      <span data-testid="status">{isPresenting ? "presenting" : "normal"}</span>
      <button onClick={toggle}>toggle</button>
    </div>
  );
}

describe("PresentationModeProvider", () => {
  it("starts in normal mode", () => {
    render(
      <PresentationModeProvider>
        <TestConsumer />
      </PresentationModeProvider>
    );
    expect(screen.getByTestId("status").textContent).toBe("normal");
  });

  it("toggles to presenting mode", () => {
    render(
      <PresentationModeProvider>
        <TestConsumer />
      </PresentationModeProvider>
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByTestId("status").textContent).toBe("presenting");
  });

  it("toggles back to normal mode", () => {
    render(
      <PresentationModeProvider>
        <TestConsumer />
      </PresentationModeProvider>
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByTestId("status").textContent).toBe("normal");
  });
});
