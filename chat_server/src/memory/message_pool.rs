// src/memory/message_pool.rs

use std::sync::atomic::{AtomicUsize, Ordering};
use std::mem::MaybeUninit;
use std::cell::UnsafeCell;

const POOL_SIZE: usize = 4096; 
const MAX_MESSAGE_SIZE: usize = 8 * 1024;  // 8 KiB

pub struct MessageSlot {
    data: [u8; MAX_MESSAGE_SIZE],
    len: usize,
}

pub struct MessagePool {
    slots: UnsafeCell<Box<[MaybeUninit<MessageSlot>; POOL_SIZE]>>, // puts data on heap because of 8MiB stack limit
    head: AtomicUsize,
    tail: AtomicUsize,
}
unsafe impl Sync for MessagePool {}
unsafe impl Send for MessagePool {}

impl MessagePool {
    pub fn new() -> Self {
        Self {
            head: AtomicUsize::new(0),
            tail: AtomicUsize::new(0),
            slots: UnsafeCell::new(Box::new(unsafe {
                MaybeUninit::uninit().assume_init()
            }))
        }
    }

    pub fn alloc(&self, size: usize) -> Option<&mut [u8]>{
        loop {
            let head = self.head.load(Ordering::Acquire);
            let next = (head + 1) % POOL_SIZE;

            if (next == self.tail.load(Ordering::Acquire)){
                return None;
            }
            match self.head.compare_exchange(
                head,
                next,
                Ordering::Release,
                Ordering::Relaxed,
            ) {
                Ok(head) => {
                    let slot = unsafe {
                        let slots = &mut *self.slots.get();
                        &mut *slots[head].as_mut_ptr()
                    };
                        slot.len = size;
                        return Some(&mut slot.data[..size])
                }
                Err(_) => {}
            }
        }
    }

    pub fn free_old(&self, count: usize){
        let tail = self.tail.load(Ordering::Acquire);
        let new_tail = (tail + count) % POOL_SIZE;
        self.tail.store(new_tail, Ordering::Release);
    }
}

