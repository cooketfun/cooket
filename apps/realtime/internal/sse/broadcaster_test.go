package sse

import (
	"sync"
	"testing"
	"time"

	"github.com/cooketfun/cooket/apps/realtime/internal/market"
)

func testEvent() market.Event {
	timestamp := uint64(123)
	return market.Event{Identity: "5042002:0xabc:7", ChainID: 5042002, Token: "0xtoken", Market: "0xmarket", Source: market.SourceCurve, Side: market.SideBuy, LogIndex: 7, BlockTimestamp: &timestamp}
}

func TestBoundedConcurrentSubscriberChurn(t *testing.T) {
	b := NewBroadcaster(8, nil)
	var workers sync.WaitGroup
	for range 32 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for range 100 {
				_, unsubscribe := b.Subscribe()
				b.Publish(testEvent())
				unsubscribe()
				unsubscribe()
			}
		}()
	}
	workers.Wait()
	if b.Len() != 0 {
		t.Fatalf("leaked subscribers: %d", b.Len())
	}
}

func receive(t *testing.T, ch <-chan market.Event) market.Event {
	t.Helper()
	select {
	case event, ok := <-ch:
		if !ok {
			t.Fatal("subscriber closed")
		}
		return event
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for event")
		return market.Event{}
	}
}

func TestBroadcasterFanoutAndStableIdentity(t *testing.T) {
	b := NewBroadcaster(2, nil)
	first, removeFirst := b.Subscribe()
	second, removeSecond := b.Subscribe()
	defer removeFirst()
	defer removeSecond()
	b.Publish(testEvent())
	if got := receive(t, first); got.Identity != testEvent().Identity {
		t.Fatalf("identity = %q", got.Identity)
	}
	if got := receive(t, second); got.Identity != testEvent().Identity {
		t.Fatalf("identity = %q", got.Identity)
	}
}

func TestSubscriberAdmissionIsBounded(t *testing.T) {
	b := NewBroadcaster(1, nil)
	for range maximumSubscribers {
		_, stop := b.Subscribe()
		defer stop()
	}
	ch, stop := b.Subscribe()
	defer stop()
	if _, open := <-ch; open {
		t.Fatal("accepted subscriber above capacity")
	}
	if b.Len() != maximumSubscribers {
		t.Fatalf("subscribers=%d", b.Len())
	}
}

func TestBroadcasterUnsubscribeAndSlowClientRemoval(t *testing.T) {
	slowRemoved := make(chan struct{}, 1)
	b := NewBroadcaster(1, func() { slowRemoved <- struct{}{} })
	slow, _ := b.Subscribe()
	fast, removeFast := b.Subscribe()
	defer removeFast()
	b.Publish(testEvent())
	if got := receive(t, fast); got.Identity == "" {
		t.Fatal("missing fast event")
	}
	b.Publish(testEvent()) // slow queue is full, but the drained fast queue receives this without blocking.
	if got := receive(t, fast); got.Identity == "" {
		t.Fatal("missing post-removal fast event")
	}
	select {
	case <-slowRemoved:
	case <-time.After(time.Second):
		t.Fatal("slow subscriber was not removed")
	}
	if got := receive(t, slow); got.Identity == "" {
		t.Fatal("slow subscriber lost its already-queued event")
	}
	if _, ok := <-slow; ok {
		t.Fatal("slow subscriber channel remained open")
	}
	if b.Len() != 1 {
		t.Fatalf("subscriber count = %d, want 1", b.Len())
	}
}
