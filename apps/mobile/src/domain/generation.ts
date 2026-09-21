// Each asynchronous identity-bound operation captures a ticket before dispatch.
// Switching identity invalidates all earlier tickets, including same-user relogin.
export class Generation {
  private value = 0;
  next() { return ++this.value; }
  current(ticket: number) { return ticket === this.value; }
  capture() { return this.value; }
}
