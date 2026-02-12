package main

import (
	"testing"

	zone "github.com/lrstanley/bubblezone"
)

func TestParseMouseSGR(t *testing.T) {
	msg, ok := parseMouseSGR("<0;10;7m")
	if !ok {
		t.Fatalf("expected valid SGR mouse message")
	}
	if msg.X != 9 || msg.Y != 6 {
		t.Fatalf("unexpected coordinates: %+v", msg)
	}
	if msg.Button != zone.MouseButtonLeft {
		t.Fatalf("expected left button, got %+v", msg.Button)
	}
	if msg.Action != zone.MouseActionRelease {
		t.Fatalf("expected release action, got %+v", msg.Action)
	}
}

func TestResolveMouseOptionClick(t *testing.T) {
	zone.NewGlobal()
	_ = zone.Scan(zone.Mark(optionZoneID(1), "Option row"))
	msg := zone.MouseMsg{
		X:      2,
		Y:      0,
		Button: zone.MouseButtonLeft,
		Action: zone.MouseActionPress,
	}
	idx, ok := resolveMouseOptionClick(msg, 3)
	if !ok {
		t.Fatalf("expected click hit for option")
	}
	if idx != 1 {
		t.Fatalf("expected option index 1, got %d", idx)
	}
}

func TestResolveMouseJourneyClick(t *testing.T) {
	zone.NewGlobal()
	_ = zone.Scan(zone.Mark(journeyZoneID(1), "2. Provider"))
	msg := zone.MouseMsg{
		X:      2,
		Y:      0,
		Button: zone.MouseButtonLeft,
		Action: zone.MouseActionPress,
	}

	idx, ok := resolveMouseJourneyClick(msg, 6, 3)
	if !ok {
		t.Fatalf("expected click hit for journey")
	}
	if idx != 1 {
		t.Fatalf("expected journey index 1, got %d", idx)
	}
}

func TestResolveMouseJourneyClickIgnoresFutureSteps(t *testing.T) {
	zone.NewGlobal()
	_ = zone.Scan(zone.Mark(journeyZoneID(4), "5. Review"))
	msg := zone.MouseMsg{
		X:      2,
		Y:      0,
		Button: zone.MouseButtonLeft,
		Action: zone.MouseActionPress,
	}

	if _, ok := resolveMouseJourneyClick(msg, 6, 2); ok {
		t.Fatalf("expected future journey step click to be ignored")
	}
}
