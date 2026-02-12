package zone

import (
	"fmt"
	"strings"
	"sync"
	"unicode/utf8"
)

type MouseButton uint8

const (
	MouseButtonNone MouseButton = iota
	MouseButtonLeft
	MouseButtonMiddle
	MouseButtonRight
)

type MouseAction uint8

const (
	MouseActionPress MouseAction = iota
	MouseActionRelease
	MouseActionMotion
)

type MouseMsg struct {
	X      int
	Y      int
	Button MouseButton
	Action MouseAction
	Alt    bool
	Ctrl   bool
	Shift  bool
}

type Zone struct {
	ID string

	minX int
	minY int
	maxX int
	maxY int
}

func (z *Zone) InBounds(msg MouseMsg) bool {
	if z == nil {
		return false
	}
	x := msg.X
	y := msg.Y
	if y < z.minY || y > z.maxY {
		return false
	}
	if z.minY == z.maxY {
		return x >= z.minX && x <= z.maxX
	}
	if y == z.minY {
		return x >= z.minX
	}
	if y == z.maxY {
		return x <= z.maxX
	}
	return true
}

type Manager struct {
	mu sync.RWMutex

	zones map[string]*Zone

	nextCode  int
	idToCode  map[string]string
	codeToID  map[string]string
	activePos map[string][2]int
}

func New() *Manager {
	return &Manager{
		zones:     map[string]*Zone{},
		idToCode:  map[string]string{},
		codeToID:  map[string]string{},
		activePos: map[string][2]int{},
	}
}

var (
	globalMu sync.Mutex
	global   = New()
)

func NewGlobal() *Manager {
	globalMu.Lock()
	defer globalMu.Unlock()
	global = New()
	return global
}

func Mark(id, value string) string {
	return ensureGlobal().Mark(id, value)
}

func Scan(value string) string {
	return ensureGlobal().Scan(value)
}

func Get(id string) *Zone {
	return ensureGlobal().Get(id)
}

func (m *Manager) Mark(id, value string) string {
	m.mu.Lock()
	defer m.mu.Unlock()

	code, ok := m.idToCode[id]
	if !ok {
		m.nextCode++
		code = fmt.Sprintf("%x", m.nextCode)
		m.idToCode[id] = code
		m.codeToID[code] = id
	}

	return startMarker(code) + value + endMarker(code)
}

func (m *Manager) Scan(value string) string {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.zones = map[string]*Zone{}
	m.activePos = map[string][2]int{}

	var out strings.Builder
	x := 0
	y := 0

	for i := 0; i < len(value); {
		if code, consumed, ok := parseMarker(value[i:], "9000"); ok {
			m.activePos[code] = [2]int{x, y}
			i += consumed
			continue
		}
		if code, consumed, ok := parseMarker(value[i:], "9001"); ok {
			start, exists := m.activePos[code]
			if exists {
				delete(m.activePos, code)
				id := m.codeToID[code]
				if id != "" {
					m.zones[id] = &Zone{
						ID:   id,
						minX: start[0],
						minY: start[1],
						maxX: x,
						maxY: y,
					}
				}
			}
			i += consumed
			continue
		}
		if value[i] == 0x1b {
			seq, consumed, ok := parseANSI(value[i:])
			if ok {
				out.WriteString(seq)
				i += consumed
				continue
			}
		}

		r, size := utf8.DecodeRuneInString(value[i:])
		if r == utf8.RuneError && size == 1 {
			out.WriteByte(value[i])
			x++
			i++
			continue
		}
		out.WriteRune(r)
		if r == '\n' {
			y++
			x = 0
		} else if r != '\r' {
			x++
		}
		i += size
	}

	return out.String()
}

func (m *Manager) Get(id string) *Zone {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.zones[id]
}

func ensureGlobal() *Manager {
	globalMu.Lock()
	defer globalMu.Unlock()
	if global == nil {
		global = New()
	}
	return global
}

func startMarker(code string) string {
	return "\x1b[9000;" + code + "z"
}

func endMarker(code string) string {
	return "\x1b[9001;" + code + "z"
}

func parseMarker(input, markerType string) (string, int, bool) {
	prefix := "\x1b[" + markerType + ";"
	if !strings.HasPrefix(input, prefix) {
		return "", 0, false
	}
	rest := input[len(prefix):]
	end := strings.IndexByte(rest, 'z')
	if end < 0 {
		return "", 0, false
	}
	code := rest[:end]
	if code == "" {
		return "", 0, false
	}
	return code, len(prefix) + end + 1, true
}

func parseANSI(input string) (string, int, bool) {
	if len(input) < 2 || input[0] != 0x1b {
		return "", 0, false
	}
	for i := 1; i < len(input); i++ {
		ch := input[i]
		if (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') {
			return input[:i+1], i + 1, true
		}
	}
	return "", 0, false
}
