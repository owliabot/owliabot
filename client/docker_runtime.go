package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type dockerStatus struct {
	Installed     bool
	Running       bool
	ClientVersion string
	ServerVersion string
	LastError     string
}

type imageUpdateInfo struct {
	ImageRef      string
	LocalDigest   string
	RemoteDigest  string
	HasLocal      bool
	HasRemote     bool
	RemoteChecked bool
	CheckError    string
}

var execLookPath = exec.LookPath

var execCombinedOutput = func(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

var detectImageUpdateFn = detectImageUpdate
var detectLocalImageFn = detectLocalImage
var pullDockerImageWithProgressFn = pullDockerImageWithProgress
var startDockerComposeFn = startDockerCompose
var fetchNewestImageTagFn = fetchNewestImageTag

func detectLocalImage(imageRef string) bool {
	_, err := execCombinedOutput("docker", "image", "inspect", "--format", "{{.ID}}", imageRef)
	return err == nil
}

func detectDockerStatus() dockerStatus {
	status := dockerStatus{}
	if _, err := execLookPath("docker"); err != nil {
		status.Installed = false
		status.Running = false
		status.LastError = "Docker CLI not found"
		return status
	}

	status.Installed = true
	clientVersion, _ := execCombinedOutput("docker", "version", "--format", "{{.Client.Version}}")
	status.ClientVersion = firstLine(clientVersion)

	serverVersion, err := execCombinedOutput("docker", "info", "--format", "{{.ServerVersion}}")
	if err != nil {
		status.Running = false
		status.ServerVersion = ""
		status.LastError = firstLine(serverVersion)
		return status
	}

	status.Running = true
	status.ServerVersion = firstLine(serverVersion)
	return status
}

func buildDockerHighlights(configDir, outputDir string, status dockerStatus) []string {
	lines := []string{
		"Mode: Docker setup",
		fmt.Sprintf("Config directory: %s", configDir),
		fmt.Sprintf("Output directory: %s", outputDir),
	}

	if status.Installed {
		client := "Docker CLI: installed"
		if strings.TrimSpace(status.ClientVersion) != "" {
			client += fmt.Sprintf(" (v%s)", strings.TrimSpace(status.ClientVersion))
		}
		lines = append(lines, client)
	} else {
		lines = append(lines, "Docker CLI: not installed")
	}

	if status.Running {
		server := "Docker engine: running"
		if strings.TrimSpace(status.ServerVersion) != "" {
			server += fmt.Sprintf(" (v%s)", strings.TrimSpace(status.ServerVersion))
		}
		lines = append(lines, server)
	} else if status.Installed {
		lines = append(lines, "Docker engine: not running")
	}

	if strings.TrimSpace(status.LastError) != "" {
		lines = append(lines, "Docker check: "+status.LastError)
	}

	return lines
}

func detectImageUpdate(imageRef string) imageUpdateInfo {
	info := imageUpdateInfo{ImageRef: normalizeImageRef(imageRef)}
	repo := imageRepository(info.ImageRef)

	localRaw, localErr := execCombinedOutput("docker", "image", "inspect", "--format", "{{json .RepoDigests}}", info.ImageRef)
	if localErr == nil {
		if digest := parseLocalDigestFromRepoDigests(localRaw, repo); digest != "" {
			info.LocalDigest = digest
			info.HasLocal = true
		}
	}

	remoteRaw, remoteErr := execCombinedOutput("docker", "manifest", "inspect", "--verbose", info.ImageRef)
	if remoteErr != nil {
		remoteRaw, remoteErr = execCombinedOutput("docker", "manifest", "inspect", info.ImageRef)
	}
	if remoteErr != nil {
		info.CheckError = firstLine(remoteRaw)
		return info
	}

	info.RemoteChecked = true
	if digest := parseRemoteDigestFromManifest(remoteRaw); digest != "" {
		info.RemoteDigest = digest
		info.HasRemote = true
	}
	return info
}

func parseLocalDigestFromRepoDigests(raw string, repo string) string {
	var digests []string
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &digests); err != nil {
		return ""
	}
	for _, entry := range digests {
		parts := strings.SplitN(entry, "@", 2)
		if len(parts) != 2 {
			continue
		}
		if strings.TrimSpace(parts[0]) == strings.TrimSpace(repo) {
			return strings.TrimSpace(parts[1])
		}
	}
	if len(digests) == 0 {
		return ""
	}
	parts := strings.SplitN(digests[0], "@", 2)
	if len(parts) != 2 {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

func parseRemoteDigestFromManifest(raw string) string {
	var payload map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &payload); err != nil {
		return ""
	}

	if descriptor, ok := payload["Descriptor"].(map[string]any); ok {
		if digest, ok := descriptor["digest"].(string); ok && strings.HasPrefix(digest, "sha256:") {
			return digest
		}
	}
	if digest, ok := payload["digest"].(string); ok && strings.HasPrefix(digest, "sha256:") {
		return digest
	}
	if manifests, ok := payload["manifests"].([]any); ok && len(manifests) > 0 {
		if first, ok := manifests[0].(map[string]any); ok {
			if digest, ok := first["digest"].(string); ok && strings.HasPrefix(digest, "sha256:") {
				return digest
			}
		}
	}

	return ""
}

func imageRepository(imageRef string) string {
	ref := strings.TrimSpace(imageRef)
	if ref == "" {
		return "ghcr.io/owliabot/owliabot"
	}
	if at := strings.Index(ref, "@"); at >= 0 {
		ref = ref[:at]
	}
	lastSlash := strings.LastIndex(ref, "/")
	lastColon := strings.LastIndex(ref, ":")
	if lastColon > lastSlash {
		ref = ref[:lastColon]
	}
	return ref
}

func imageTagOrDefault(imageRef string) string {
	ref := strings.TrimSpace(imageRef)
	if ref == "" {
		return "latest"
	}
	if at := strings.Index(ref, "@"); at >= 0 {
		return ref[at+1:]
	}
	lastSlash := strings.LastIndex(ref, "/")
	lastColon := strings.LastIndex(ref, ":")
	if lastColon > lastSlash {
		return ref[lastColon+1:]
	}
	return "latest"
}

func normalizeImageRef(imageRef string) string {
	imageRef = strings.TrimSpace(imageRef)
	if imageRef == "" {
		return "ghcr.io/owliabot/owliabot:latest"
	}
	return imageRef
}

func applyImageSelection(baseImage, input string) string {
	base := normalizeImageRef(baseImage)
	selected := strings.TrimSpace(input)
	if selected == "" {
		return base
	}
	if strings.Contains(selected, "/") {
		return selected
	}
	repo := imageRepository(base)
	if strings.HasPrefix(selected, "sha256:") {
		return repo + "@" + selected
	}
	if strings.HasPrefix(selected, "@") || strings.HasPrefix(selected, ":") {
		return repo + selected
	}
	if strings.Contains(selected, "@") || strings.Contains(selected, ":") {
		return selected
	}
	return repo + ":" + selected
}

func fetchNewestImageTag(imageRef string) string {
	registry, repo := parseImageRegistryAndRepo(imageRef)
	if registry == "" || repo == "" {
		return ""
	}
	if registry != "ghcr.io" {
		return ""
	}
	tags, err := fetchRegistryTags(registry, repo)
	if err != nil {
		return ""
	}
	return newestTagFromList(tags)
}

func parseImageRegistryAndRepo(imageRef string) (string, string) {
	ref := strings.TrimSpace(normalizeImageRef(imageRef))
	repo := imageRepository(ref)
	parts := strings.Split(repo, "/")
	if len(parts) < 2 {
		return "", repo
	}
	if strings.Contains(parts[0], ".") || strings.Contains(parts[0], ":") {
		return parts[0], strings.Join(parts[1:], "/")
	}
	return "docker.io", repo
}

func fetchRegistryTags(registry, repo string) ([]string, error) {
	client := &http.Client{Timeout: 4 * time.Second}
	token := ""
	if registry == "ghcr.io" {
		tokenURL := fmt.Sprintf("https://%s/token?service=%s&scope=%s", registry, registry, url.QueryEscape("repository:"+repo+":pull"))
		req, _ := http.NewRequest(http.MethodGet, tokenURL, nil)
		resp, err := client.Do(req)
		if err == nil && resp != nil {
			defer resp.Body.Close()
			var payload struct {
				Token       string `json:"token"`
				AccessToken string `json:"access_token"`
			}
			if json.NewDecoder(resp.Body).Decode(&payload) == nil {
				token = strings.TrimSpace(payload.Token)
				if token == "" {
					token = strings.TrimSpace(payload.AccessToken)
				}
			}
		}
	}

	tagsURL := fmt.Sprintf("https://%s/v2/%s/tags/list?n=200", registry, repo)
	req, _ := http.NewRequest(http.MethodGet, tagsURL, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("registry tags request failed: %s", resp.Status)
	}
	var payload struct {
		Tags []string `json:"tags"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	return payload.Tags, nil
}

func newestTagFromList(tags []string) string {
	if len(tags) == 0 {
		return ""
	}
	candidates := make([]string, 0, len(tags))
	for _, tag := range tags {
		clean := strings.TrimSpace(tag)
		if clean == "" {
			continue
		}
		switch clean {
		case "latest", "develop":
			continue
		}
		candidates = append(candidates, clean)
	}
	if len(candidates) == 0 {
		return ""
	}

	type versionTag struct {
		Tag   string
		Parts []int
	}
	semver := make([]versionTag, 0, len(candidates))
	nonSemver := make([]string, 0, len(candidates))
	for _, tag := range candidates {
		if parts, ok := parseNumericTag(tag); ok {
			semver = append(semver, versionTag{Tag: tag, Parts: parts})
		} else {
			nonSemver = append(nonSemver, tag)
		}
	}
	if len(semver) > 0 {
		sort.SliceStable(semver, func(i, j int) bool {
			a := semver[i].Parts
			b := semver[j].Parts
			maxLen := len(a)
			if len(b) > maxLen {
				maxLen = len(b)
			}
			for idx := 0; idx < maxLen; idx++ {
				av := 0
				bv := 0
				if idx < len(a) {
					av = a[idx]
				}
				if idx < len(b) {
					bv = b[idx]
				}
				if av != bv {
					return av > bv
				}
			}
			return semver[i].Tag > semver[j].Tag
		})
		return semver[0].Tag
	}
	sort.Strings(nonSemver)
	return nonSemver[len(nonSemver)-1]
}

func parseNumericTag(tag string) ([]int, bool) {
	clean := strings.TrimPrefix(strings.TrimSpace(tag), "v")
	if clean == "" {
		return nil, false
	}
	parts := strings.Split(clean, ".")
	if len(parts) < 2 {
		return nil, false
	}
	out := make([]int, 0, len(parts))
	for _, part := range parts {
		if part == "" {
			return nil, false
		}
		numPart := part
		for i, r := range part {
			if r < '0' || r > '9' {
				numPart = part[:i]
				break
			}
		}
		if numPart == "" {
			return nil, false
		}
		v, err := strconv.Atoi(numPart)
		if err != nil {
			return nil, false
		}
		out = append(out, v)
	}
	return out, true
}

func pullDockerImage(imageRef string) error {
	out, err := execCombinedOutput("docker", "pull", imageRef)
	if err != nil {
		return fmt.Errorf("docker pull failed: %s", firstLine(out))
	}
	return nil
}

func pullDockerImageWithProgress(imageRef string, onUpdate func(string)) error {
	cmd := exec.Command("docker", "pull", imageRef)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("docker pull failed: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("docker pull failed: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("docker pull failed: %w", err)
	}

	lines := make(chan string, 64)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		scanPullStream(stdout, lines)
	}()
	go func() {
		defer wg.Done()
		scanPullStream(stderr, lines)
	}()
	go func() {
		wg.Wait()
		close(lines)
	}()

	for line := range lines {
		if onUpdate != nil {
			onUpdate(line)
		}
	}

	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("docker pull failed: %w", err)
	}
	return nil
}

func scanPullStream(r io.Reader, sink chan<- string) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 1024), 1024*1024)
	scanner.Split(splitDockerProgressLines)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		sink <- line
	}
}

func splitDockerProgressLines(data []byte, atEOF bool) (advance int, token []byte, err error) {
	for i, b := range data {
		if b != '\n' && b != '\r' {
			continue
		}
		if i == 0 {
			return 1, nil, nil
		}
		return i + 1, bytes.TrimSpace(data[:i]), nil
	}
	if atEOF && len(data) > 0 {
		return len(data), bytes.TrimSpace(data), nil
	}
	return 0, nil, nil
}

func startDockerCompose(outputDir, imageRef string) error {
	cmd := exec.Command("docker", "compose", "up", "-d")
	cmd.Dir = outputDir
	cmd.Env = append(os.Environ(), "OWLIABOT_IMAGE="+imageRef)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("docker compose up failed: %s", firstLine(string(out)))
	}
	return nil
}

func firstLine(text string) string {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return ""
	}
	lines := strings.Split(trimmed, "\n")
	return strings.TrimSpace(lines[0])
}
