use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicUsize, Ordering};

pub(crate) const POOL_SIZE: usize = 4096;
pub const MAX_MESSAGE_SIZE: usize = 8 * 1024;

pub struct MessagePool {
    // Flat, heap-allocated ring buffer of POOL_SIZE fixed-size windows, each
    // MAX_MESSAGE_SIZE bytes. `vec![0u8; N]` is specialized by the standard
    // library to allocate zeroed memory directly — no large stack
    // intermediate. This replaced a `Box<[MaybeUninit<MessageSlot>; POOL_SIZE]>`
    // (a 32MB array-of-structs) that relied on the optimizer eliding a
    // stack-then-move construction of that whole value before boxing it —
    // not a language guarantee, and it reliably stack-overflowed in debug
    // builds (reproduced via a `cargo test` run); it only survived release
    // builds by luck of the current LLVM version's behavior.
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
                // SAFETY: `head` was just exclusively claimed via the CAS
                // above — no other in-flight call can be using this same
                // window until this index is recycled by a matching
                // free_old(). We take a raw pointer to the buffer's start
                // and offset into it, never a `&mut` to the whole buffer,
                // so concurrently-claimed (disjoint) windows never alias.
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
