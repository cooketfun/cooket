package market

import "sync"

type Deduper struct {
	mu       sync.Mutex
	capacity int
	seen     map[string]struct{}
	order    []string
}

func NewDeduper(capacity int) *Deduper {
	if capacity < 1 {
		capacity = 1
	}
	return &Deduper{capacity: capacity, seen: make(map[string]struct{}, capacity), order: make([]string, 0, capacity)}
}

// Accept treats a removed notification as a distinct delivery state for the
// same chain log. That lets consumers retract realtime UX once, while still
// suppressing duplicate normal or duplicate removed deliveries.
func (d *Deduper) Accept(id EventID, removed bool) bool {
	key := id.String()
	if removed {
		key += ":removed"
	} else {
		key += ":canonical"
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if _, exists := d.seen[key]; exists {
		return false
	}
	if len(d.order) == d.capacity {
		delete(d.seen, d.order[0])
		copy(d.order, d.order[1:])
		d.order[len(d.order)-1] = key
	} else {
		d.order = append(d.order, key)
	}
	d.seen[key] = struct{}{}
	return true
}
