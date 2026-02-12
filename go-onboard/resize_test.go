package main

import (
	"testing"
)

func TestRenderOnResizeRerendersLastView(t *testing.T) {
	count := 0
	w := &wizardSession{
		steps: cloneSlice(defaultWizardSteps),
		renderer: func(_ popupView) {
			count++
		},
	}

	w.render("Welcome", "Do you want to continue?", []string{"Yes", "No"}, "Type number and press Enter", "", 0, []string{"Mode: Docker"}, "", false)
	if count != 1 {
		t.Fatalf("expected initial render to be called once, got %d", count)
	}

	w.renderOnResize()
	if count != 2 {
		t.Fatalf("expected resize rerender to be called, got %d", count)
	}
}
