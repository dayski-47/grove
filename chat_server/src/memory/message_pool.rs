use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicUsize, Ordering};

pub(crate) const POOL_SIZE: usize = 4096;
pub const MAX_MESSAGE_SIZE: usize = 8 * 1024;

pub struct MessagePool {
    // Flat ring buffer, POOL_SIZE windows of MAX_MESSAGE_SIZE bytes each.
    // Used to be a boxed [MaybeUninit<MessageSlot>; POOL_SIZE] — that 32MB
    // value got built on the stack before moving into the box, which isn't
    // guaranteed and overflowed debug builds. vec![0u8; N] avoids that.
    buf: UnsafeCell<Vec<u8>>,
    head: AtomicUsize,
    tail: AtomicUsize,
}
unsafe impl Sync for MessagePool {}
unsafe impl Send for MessagePool {}

impl MessagePool {
    pub fn new() -> Self {
        Self {
            buf: UnsafeCell::new(vec![0u8; POOL_SIZE * MAX_MESSAGE_SIZE]),
            head: AtomicUsize::new(0),
            tail: AtomicUsize::new(0),
        }
    }

    #[allow(clippy::mut_from_ref)]
    pub fn alloc(&self, size: usize) -> Option<&mut [u8]> {
        if size > MAX_MESSAGE_SIZE {
            return None;
        }
        loop {
            let head = self.head.load(Ordering::Acquire);
            let next = (head + 1) % POOL_SIZE;
            if next == self.tail.load(Ordering::Acquire) {
                return None;
            }
            if self
                .head
                .compare_exchange(head, next, Ordering::Release, Ordering::Relaxed)
                .is_ok()
            {
                let start = head * MAX_MESSAGE_SIZE;
                // SAFETY: the CAS above exclusively claimed this window —
                // no one else touches it until a matching free_old() frees
                // it. Only a raw pointer into the buffer, never a &mut to
                // the whole thing, so disjoint claimed windows can't alias.
                let ptr = unsafe { (*self.buf.get()).as_mut_ptr().add(start) };
                let slice = unsafe { std::slice::from_raw_parts_mut(ptr, size) };
                return Some(slice);
            }
        }
    }

    pub fn free_old(&self, count: usize) {
        let tail = self.tail.load(Ordering::Acquire);
        self.tail
            .store((tail + count) % POOL_SIZE, Ordering::Release);
    }
}
