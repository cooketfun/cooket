// Package sse provides the bounded, in-process fanout used by the realtime HTTP endpoint.
package sse

import (
	"sync"

	"github.com/cooketfun/cooket/apps/realtime/internal/market"
)

// Broadcaster never blocks Publish. A subscriber whose bounded queue is full is
// removed and disconnected, rather than allowing one slow client to delay Arc
// WebSocket ingestion or grow process memory without bound.
type Broadcaster struct {
	mu          sync.Mutex
	subscribers map[uint64]chan market.Event
	nextID      uint64
	buffer      int
	onSlow      func()
}

func NewBroadcaster(buffer int, onSlow func()) *Broadcaster {
	if buffer < 1 {
		panic("SSE subscriber buffer must be positive")
	}
	return &Broadcaster{subscribers: make(map[uint64]chan market.Event), buffer: buffer, onSlow: onSlow}
}

func (b *Broadcaster) Subscribe() (<-chan market.Event, func()) {
	b.mu.Lock()
	id := b.nextID
	b.nextID++
	ch := make(chan market.Event, b.buffer)
	b.subscribers[id] = ch
	b.mu.Unlock()
	var once sync.Once
	return ch, func() { once.Do(func() { b.remove(id) }) }
}

func (b *Broadcaster) Publish(event market.Event) {
	b.mu.Lock()
	removed := 0
	for id, ch := range b.subscribers {
		select {
		case ch <- event:
		default:
			delete(b.subscribers, id)
			close(ch)
			removed++
		}
	}
	b.mu.Unlock()
	for range removed {
		if b.onSlow != nil {
			b.onSlow()
		}
	}
}

func (b *Broadcaster) remove(id uint64) {
	b.mu.Lock()
	if ch, ok := b.subscribers[id]; ok {
		delete(b.subscribers, id)
		close(ch)
	}
	b.mu.Unlock()
}

func (b *Broadcaster) Len() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.subscribers)
}
