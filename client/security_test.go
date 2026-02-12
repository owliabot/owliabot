package main

import "testing"

func TestDeriveWriteToolAllowListMergesAndDedupes(t *testing.T) {
	got := DeriveWriteToolAllowList(
		[]string{"100", "200", "100"},
		[]string{"300", "200"},
		[]string{"400", "300"},
	)
	want := []string{"100", "200", "300", "400"}
	if len(got) != len(want) {
		t.Fatalf("unexpected length: got=%v want=%v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("unexpected value at %d: got=%v want=%v", i, got, want)
		}
	}
}
