"""Hold an OS advisory lock until the owning Node process closes stdin."""
import fcntl
import os
import sys

fd = os.open(sys.argv[1], os.O_RDWR | os.O_CREAT, 0o600)
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    print("BUSY", flush=True)
    os.close(fd)
    sys.exit(0)
print("LOCKED", flush=True)
sys.stdin.buffer.read()
os.close(fd)
