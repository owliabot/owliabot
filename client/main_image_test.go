package main

import (
	"bufio"
	"os"
	"strings"
	"testing"
)

func newLineModeWizardSessionForTest(t *testing.T, scriptedInput string) *wizardSession {
	t.Helper()

	inputFile, err := os.CreateTemp("", "onboard-image-input-*")
	if err != nil {
		t.Fatalf("create temp input: %v", err)
	}
	t.Cleanup(func() {
		_ = inputFile.Close()
		_ = os.Remove(inputFile.Name())
	})

	return &wizardSession{
		input:        inputFile,
		reader:       bufio.NewReader(strings.NewReader(scriptedInput)),
		steps:        cloneSlice(defaultWizardSteps),
		conversation: []string{},
		renderer:     func(popupView) {},
	}
}

func TestResolveImageForLaunchNoLocalDefaultsToLatestTag(t *testing.T) {
	oldDetect := detectImageUpdateFn
	oldPull := pullDockerImageWithProgressFn
	oldFetchNewest := fetchNewestImageTagFn
	t.Cleanup(func() {
		detectImageUpdateFn = oldDetect
		pullDockerImageWithProgressFn = oldPull
		fetchNewestImageTagFn = oldFetchNewest
	})

	detectImageUpdateFn = func(imageRef string) imageUpdateInfo {
		return imageUpdateInfo{ImageRef: imageRef, HasLocal: false}
	}
	fetchNewestImageTagFn = func(imageRef string) string { return "" }

	var pulledImage string
	pullDockerImageWithProgressFn = func(imageRef string, onUpdate func(string)) error {
		pulledImage = imageRef
		if onUpdate != nil {
			onUpdate("latest: Pulling from owliabot/owliabot")
		}
		return nil
	}

	w := newLineModeWizardSessionForTest(t, "\n\n")
	imageRef, err := w.resolveImageForLaunch("ghcr.io/owliabot/owliabot:v0.1.0", false)
	if err != nil {
		t.Fatalf("resolve image for launch: %v", err)
	}
	if imageRef != "ghcr.io/owliabot/owliabot:latest" {
		t.Fatalf("expected default latest tag, got %q", imageRef)
	}
	if pulledImage != imageRef {
		t.Fatalf("expected pull image %q, got %q", imageRef, pulledImage)
	}
}

func TestResolveImageForLaunchNoLocalSkipPullDoesNotPull(t *testing.T) {
	oldLocal := detectLocalImageFn
	oldDetect := detectImageUpdateFn
	oldPull := pullDockerImageWithProgressFn
	oldFetchNewest := fetchNewestImageTagFn
	t.Cleanup(func() {
		detectLocalImageFn = oldLocal
		detectImageUpdateFn = oldDetect
		pullDockerImageWithProgressFn = oldPull
		fetchNewestImageTagFn = oldFetchNewest
	})

	detectLocalImageFn = func(imageRef string) bool {
		return false
	}

	detectCalls := []string{}
	detectImageUpdateFn = func(imageRef string) imageUpdateInfo {
		detectCalls = append(detectCalls, imageRef)
		return imageUpdateInfo{ImageRef: imageRef, HasLocal: false}
	}
	fetchNewestImageTagFn = func(imageRef string) string { return "v9.9.9" }

	pullCalled := false
	pullDockerImageWithProgressFn = func(imageRef string, onUpdate func(string)) error {
		pullCalled = true
		return nil
	}

	w := newLineModeWizardSessionForTest(t, "2\n")
	_, err := w.resolveImageForLaunch("ghcr.io/owliabot/owliabot:latest", false)
	if err == nil || !strings.Contains(err.Error(), "pull was skipped") {
		t.Fatalf("expected skipped pull error, got %v", err)
	}
	if pullCalled {
		t.Fatalf("pull should not run when user chooses No")
	}
	if len(detectCalls) != 0 {
		t.Fatalf("expected no remote update checks when local image is missing, got %v", detectCalls)
	}
}

func TestResolveImageForLaunchPullShowsProgressFeedback(t *testing.T) {
	oldDetect := detectImageUpdateFn
	oldPull := pullDockerImageWithProgressFn
	oldFetchNewest := fetchNewestImageTagFn
	t.Cleanup(func() {
		detectImageUpdateFn = oldDetect
		pullDockerImageWithProgressFn = oldPull
		fetchNewestImageTagFn = oldFetchNewest
	})

	detectImageUpdateFn = func(imageRef string) imageUpdateInfo {
		return imageUpdateInfo{ImageRef: imageRef, HasLocal: false}
	}
	fetchNewestImageTagFn = func(imageRef string) string { return "" }

	renderedSpinners := []string{}
	w := newLineModeWizardSessionForTest(t, "\n3\nv2.0.0\n")
	w.renderer = func(view popupView) {
		if strings.TrimSpace(view.Spinner) != "" {
			renderedSpinners = append(renderedSpinners, view.Spinner)
		}
	}

	pullDockerImageWithProgressFn = func(imageRef string, onUpdate func(string)) error {
		if imageRef != "ghcr.io/owliabot/owliabot:v2.0.0" {
			t.Fatalf("unexpected pull image ref: %s", imageRef)
		}
		if onUpdate != nil {
			onUpdate("v2.0.0: Pulling from owliabot/owliabot")
			onUpdate("Digest: sha256:abc123")
		}
		return nil
	}

	_, err := w.resolveImageForLaunch("ghcr.io/owliabot/owliabot:latest", false)
	if err != nil {
		t.Fatalf("resolve image for launch: %v", err)
	}

	joined := strings.Join(renderedSpinners, "\n")
	if !strings.Contains(joined, "Pulling from owliabot/owliabot") {
		t.Fatalf("expected rendered pull progress feedback, got:\n%s", joined)
	}
}

func TestResolveImageForLaunchPromptTagDoesNotResetToLatest(t *testing.T) {
	oldDetect := detectImageUpdateFn
	oldPull := pullDockerImageWithProgressFn
	oldFetchNewest := fetchNewestImageTagFn
	t.Cleanup(func() {
		detectImageUpdateFn = oldDetect
		pullDockerImageWithProgressFn = oldPull
		fetchNewestImageTagFn = oldFetchNewest
	})

	detectImageUpdateFn = func(imageRef string) imageUpdateInfo {
		return imageUpdateInfo{ImageRef: imageRef, HasLocal: false}
	}
	fetchNewestImageTagFn = func(imageRef string) string { return "" }

	var pulledImage string
	pullDockerImageWithProgressFn = func(imageRef string, onUpdate func(string)) error {
		pulledImage = imageRef
		return nil
	}

	w := newLineModeWizardSessionForTest(t, "v3.0.0\n\n")
	imageRef, err := w.resolveImageForLaunch("ghcr.io/owliabot/owliabot:latest", true)
	if err != nil {
		t.Fatalf("resolve image for launch: %v", err)
	}
	want := "ghcr.io/owliabot/owliabot:v3.0.0"
	if imageRef != want {
		t.Fatalf("expected image ref %q, got %q", want, imageRef)
	}
	if pulledImage != want {
		t.Fatalf("expected pulled image %q, got %q", want, pulledImage)
	}
}

func TestBuildImagePullTagOptionsIncludesLatestDevelopAndNewest(t *testing.T) {
	options, details := buildImagePullTagOptions("ghcr.io/owliabot/owliabot:latest", "v1.2.3")
	if len(options) != len(details) {
		t.Fatalf("options/details length mismatch: %d vs %d", len(options), len(details))
	}
	if len(options) < 4 {
		t.Fatalf("expected at least 4 options, got %v", options)
	}
	if options[0] != "latest" {
		t.Fatalf("expected first option latest, got %q", options[0])
	}
	if options[1] != "develop" {
		t.Fatalf("expected second option develop, got %q", options[1])
	}
	if options[2] != "v1.2.3" {
		t.Fatalf("expected newest tag option, got %q", options[2])
	}
	if options[len(options)-1] != "Custom tag/reference" {
		t.Fatalf("expected custom option at end, got %q", options[len(options)-1])
	}
}
