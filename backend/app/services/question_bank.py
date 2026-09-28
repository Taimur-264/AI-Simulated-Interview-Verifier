"""
Question bank - real technical interview questions with model answers.

Every interview draws a random subset (see app/api/interview.py), so candidates
never see the same set twice. Each entry carries a `model_answer` that is kept
server-side during the interview and only revealed on the /complete screen for
self-review (no automated scoring - a human reviews the session).
"""
from typing import Any, Dict, List

QUESTION_POOL: List[Dict[str, Any]] = [
    # ---- Python ----
    {
        "text": "Explain the difference between a list and a tuple in Python, and when you would use each.",
        "type": "text",
        "time_limit": 300,
        "model_answer": (
            "Lists are mutable (elements can be added/removed/replaced), tuples are immutable and hashable. "
            "Tuples are used for fixed collections and as dictionary keys / function returns; lists are used when "
            "the collection changes. Tuples are slightly smaller and their immutability makes them safe to share."
        ),
    },
    {
        "text": "What are decorators in Python and how would you write one?",
        "type": "coding",
        "time_limit": 420,
        "model_answer": (
            "A decorator wraps a function to extend its behaviour without changing it: "
            "@timeit\ndef inner(*a, **kw): start=time.time(); out=fn(*a, **kw); print(time.time()-start); return out\n"
            "return inner. Use functools.wraps to preserve metadata; decorators run at definition time."
        ),
    },
    {
        "text": "What is the GIL in CPython and why does it matter?",
        "type": "text",
        "time_limit": 300,
        "model_answer": (
            "The Global Interpreter Lock is a mutex allowing only one thread to execute Python bytecode at a time. "
            "It makes CPU-bound threads no faster with threading, but I/O-bound work still benefits. Workarounds: "
            "multiprocessing, native extensions releasing the GIL, or async I/O."
        ),
    },
    {
        "text": "Explain list comprehensions and give an example.",
        "type": "coding",
        "time_limit": 300,
        "model_answer": "A concise way to build lists: [x*x for x in range(10) if x % 2 == 0] returns squares of even numbers; readable and faster than appending in a loop.",
    },
    {
        "text": "How does memory management work in Python?",
        "type": "text",
        "time_limit": 360,
        "model_answer": (
            "Reference counting with a cyclic garbage collector for reference cycles. Objects are freed when the "
            "count reaches zero; gc.collect() forces collection. Python allocates objects from private heaps with "
            "pools/small-block allocators to reduce malloc overhead."
        ),
    },
    {
        "text": "What is the difference between deep copy and shallow copy?",
        "type": "text",
        "time_limit": 300,
        "model_answer": (
            "A shallow copy creates a new container but copies references, so nested objects are shared. A deep copy "
            "(copy.deepcopy) recursively clones nested objects. Mutating a nested object in a shallow copy affects "
            "the original."
        ),
    },
    # ---- JavaScript ----
    {
        "text": "Explain the event loop in JavaScript.",
        "type": "text",
        "time_limit": 300,
        "model_answer": (
            "The engine runs the call stack, then microtasks (promises, queueMicrotask) to exhaustion, then one "
            "macrotask (timers, I/O), repeating. That is why await resolves before setTimeout(fn, 0), and long tasks "
            "block rendering."
        ),
    },
    {
        "text": "What is the difference between == and === in JavaScript?",
        "type": "mcq",
        "options": [
            "== converts types before comparing, === compares without coercion",
            "=== converts types before comparing, == compares without coercion",
            "Both behave identically",
            "== only works with numbers",
        ],
        "answer_index": 0,
        "time_limit": 180,
        "model_answer": "== performs type coercion before comparison (null == undefined is true); === requires the same type and value. Prefer === to avoid surprises.",
    },
    {
        "text": "What does 'hoisting' mean in JavaScript?",
        "type": "text",
        "time_limit": 240,
        "model_answer": (
            "Declarations are moved to the top of their scope during compilation. var is hoisted and initialised to "
            "undefined; let/const are hoisted but stay in the temporal dead zone until the declaration line, so "
            "accessing them earlier throws."
        ),
    },
    {
        "text": "Explain closures with an example.",
        "type": "coding",
        "time_limit": 360,
        "model_answer": (
            "A function keeps access to its lexical scope after the outer function returns: "
            "function counter(){ let n=0; return ()=>++n } const c=counter(); c() // 1, c() // 2. "
            "Used for encapsulation, memoization, and event handlers."
        ),
    },
    # ---- Operating systems ----
    {
        "text": "What is a deadlock and what are the four necessary conditions for it?",
        "type": "mcq",
        "options": [
            "Mutual exclusion, hold-and-wait, no preemption, circular wait",
            "Mutual exclusion, preemption, thrashing, starvation",
            "Deadlock only requires mutual exclusion",
            "Priority inversion, paging, segmentation, swapping",
        ],
        "answer_index": 0,
        "time_limit": 240,
        "model_answer": "Mutual exclusion, hold-and-wait, no preemption and circular wait. Prevent deadlock by breaking any one condition, e.g. ordering lock acquisition to remove circular wait.",
    },
    {
        "text": "Explain the difference between a process and a thread.",
        "type": "text",
        "time_limit": 240,
        "model_answer": (
            "A process has its own address space, file descriptors and heap; threads share the process's memory and "
            "resources but have their own stack and registers. Threads are cheaper to create/switch; processes give "
            "isolation. Sharing memory between threads requires synchronisation."
        ),
    },
    {
        "text": "What is virtual memory?",
        "type": "text",
        "time_limit": 240,
        "model_answer": (
            "Each process gets a contiguous logical address space mapped to physical memory by the MMU via page "
            "tables. Pages not in RAM are swapped to disk; accessing them triggers a page fault. Benefits: isolation, "
            "larger-than-RAM programs, simpler linking. Cost: TLB/page-fault overhead."
        ),
    },
    {
        "text": "What is a context switch and why is it expensive?",
        "type": "text",
        "time_limit": 240,
        "model_answer": (
            "Saving the CPU state of the running task and restoring another. Cost comes from pipeline/TLB/cache "
            "cold-starts and kernel bookkeeping. Excessive switching causes thrashing; modern OSes use priorities "
            "and preemption to limit it."
        ),
    },
    # ---- Databases ----
    {
        "text": "What is the difference between DELETE, TRUNCATE and DROP?",
        "type": "mcq",
        "options": [
            "DELETE removes rows (loggable, can be filtered), TRUNCATE removes all rows fast, DROP removes the table itself",
            "They are all identical",
            "DROP removes rows, DELETE removes the table",
            "TRUNCATE can only remove one row",
        ],
        "answer_index": 0,
        "time_limit": 240,
        "model_answer": "DELETE removes matching rows with row-level logging and WHERE support; TRUNCATE deallocates the whole table quickly with minimal logging; DROP removes the table structure and data entirely.",
    },
    {
        "text": "Explain database indexing. When does it help and when can it hurt?",
        "type": "text",
        "time_limit": 360,
        "model_answer": (
            "An index (usually a B-tree) is a sorted auxiliary structure that avoids full table scans on "
            "indexed columns. Helps on WHERE/JOIN/ORDER BY columns; hurts on heavy writes (extra maintenance), "
            "low-selectivity columns, unused columns, and when the optimizer picks a wrong index."
        ),
    },
    {
        "text": "What are ACID properties?",
        "type": "text",
        "time_limit": 300,
        "model_answer": (
            "Atomicity (all-or-nothing), Consistency (constraints hold), Isolation (concurrent transactions don't "
            "interfere - handled via locking/MVCC), Durability (committed data survives crashes, e.g. WAL + fsync)."
        ),
    },
    {
        "text": "What is a JOIN? Name the common types.",
        "type": "text",
        "time_limit": 300,
        "model_answer": (
            "Combining rows from two tables on a related column. INNER (matching in both), LEFT (all from left plus "
            "matches), RIGHT (all from right), FULL OUTER (all from both), plus CROSS and SELF joins."
        ),
    },
    # ---- Networking ----
    {
        "text": "What happens when you type a URL into a browser and press Enter?",
        "type": "text",
        "time_limit": 420,
        "model_answer": (
            "DNS lookup (cache → resolver → authoritative), TCP handshake, TLS handshake for HTTPS, HTTP request/"
            "response, browser rendering (DOM/CSSOM → layout → paint), JS execution. May include proxies, CDNs and "
            "caching at several steps."
        ),
    },
    {
        "text": "Explain the difference between TCP and UDP.",
        "type": "mcq",
        "options": [
            "TCP is connection-oriented and reliable; UDP is connectionless and best-effort",
            "UDP guarantees delivery, TCP does not",
            "Both are identical except for port numbers",
            "TCP is only used for video streaming",
        ],
        "answer_index": 0,
        "time_limit": 240,
        "model_answer": "TCP: handshakes, ordering, retransmission and congestion control - reliable but higher latency. UDP: no connection/ordering guarantees - lower overhead, used for DNS, gaming and live media.",
    },
    {
        "text": "What is the difference between HTTP and HTTPS?",
        "type": "text",
        "time_limit": 240,
        "model_answer": (
            "HTTPS is HTTP inside TLS: the certificate proves the server's identity and the session keys encrypt "
            "traffic, providing confidentiality and integrity against eavesdropping and tampering. Port 443 vs 80."
        ),
    },
    {
        "text": "What does an HTTP status code of 401 vs 403 mean?",
        "type": "mcq",
        "options": [
            "401 = not authenticated (who are you?), 403 = authenticated but not allowed (not for you)",
            "401 = forbidden, 403 = unauthenticated",
            "Both mean the same thing",
            "401 = server error, 403 = client error",
        ],
        "answer_index": 0,
        "time_limit": 180,
        "model_answer": "401 Unauthorized means credentials are missing/invalid - authenticate. 403 Forbidden means the identity is known but lacks permission for the resource.",
    },
    # ---- Data structures & algorithms ----
    {
        "text": "Write a function that returns the second largest number in a list.",
        "type": "coding",
        "time_limit": 420,
        "model_answer": (
            "def second_largest(nums):\n"
            "    vals = list(set(nums))\n"
            "    if len(vals) < 2: raise ValueError('need at least two distinct values')\n"
            "    return sorted(vals)[-2]\n"
            "# O(n) variant: track largest and second largest in one pass."
        ),
    },
    {
        "text": "Reverse a singly linked list and state its time complexity.",
        "type": "coding",
        "time_limit": 600,
        "model_answer": (
            "def reverse(head):\n"
            "    prev = None\n"
            "    while head:\n"
            "        nxt = head.next\n"
            "        head.next = prev\n"
            "        prev = head\n"
            "        head = nxt\n"
            "    return prev\n"
            "O(n) time, O(1) extra space by relinking in place."
        ),
    },
    {
        "text": "What is the difference between an array and a linked list?",
        "type": "text",
        "time_limit": 300,
        "model_answer": (
            "Arrays are contiguous: O(1) indexing, fast iteration, but insertion/deletion in the middle is O(n) and "
            "resizing costs. Linked lists store next-pointers: O(1) insert/delete given a node, no random access, "
            "extra memory per node and worse cache locality."
        ),
    },
    {
        "text": "Explain Big-O notation and compare O(n log n) with O(n^2).",
        "type": "text",
        "time_limit": 300,
        "model_answer": (
            "Big-O describes growth rate as input size increases, ignoring constants. O(n log n) (merge sort, "
            "efficient comparisons) scales far better than O(n^2) (bubble sort): at n=10,000 that's ~130k vs "
            "100M operations - the difference between usable and unusable."
        ),
    },
    {
        "text": "Given an array of integers, return the two indices whose values sum to a target.",
        "type": "coding",
        "time_limit": 480,
        "model_answer": (
            "def two_sum(nums, target):\n"
            "    seen = {}\n"
            "    for i, x in enumerate(nums):\n"
            "        if target - x in seen:\n"
            "            return [seen[target - x], i]\n"
            "        seen[x] = i\n"
            "O(n) with a hash map instead of O(n^2) brute force."
        ),
    },
    # ---- Security / web ----
    {
        "text": "What is SQL injection and how do you prevent it?",
        "type": "text",
        "time_limit": 300,
        "model_answer": (
            "Attacker-supplied input is interpolated into SQL so it changes the query (e.g. ' OR 1=1 --). Prevent "
            "with parameterised queries/ORM bindings, least-privilege DB accounts, input validation and WAF rules. "
            "String concatenation of user input is the root cause."
        ),
    },
    {
        "text": "How does HTTPS protect data in transit?",
        "type": "text",
        "time_limit": 300,
        "model_answer": (
            "TLS combines asymmetric crypto (exchange a session key, authenticate via certificate chain) with "
            "symmetric encryption (AES-GCM) for the actual data. Provides confidentiality, integrity (HMAC/AEAD) and "
            "server authentication."
        ),
    },
    {
        "text": "What is XSS (Cross-Site Scripting)?",
        "type": "mcq",
        "options": [
            "Injecting malicious scripts into pages viewed by others",
            "Crashing a server with excess traffic",
            "Brute-forcing passwords",
            "Stealing database backups",
        ],
        "answer_index": 0,
        "time_limit": 240,
        "model_answer": "XSS injects attacker JavaScript into content other users render. Prevent with output encoding, Content-Security-Policy, HttpOnly cookies and sanitising rich HTML input.",
    },
    {
        "text": "What is the principle of least privilege?",
        "type": "text",
        "time_limit": 240,
        "model_answer": (
            "Every user, process and service gets only the permissions strictly needed for its task, for the minimum "
            "time. Limits blast radius of compromise; implemented via roles, scoped API tokens and separate service "
            "accounts."
        ),
    },
    # ---- DevOps / cloud ----
    {
        "text": "What is the difference between horizontal and vertical scaling?",
        "type": "mcq",
        "options": [
            "Horizontal adds more machines; vertical makes one machine bigger",
            "Vertical adds more machines; horizontal makes one machine bigger",
            "Both mean the same thing",
            "Horizontal only applies to databases",
        ],
        "answer_index": 0,
        "time_limit": 240,
        "model_answer": "Vertical (scale up) = bigger CPU/RAM on one node: simple but has a ceiling and single point of failure. Horizontal (scale out) = more nodes behind a load balancer: resilient and elastic, but needs stateless services and data partitioning.",
    },
    {
        "text": "What is CI/CD?",
        "type": "text",
        "time_limit": 240,
        "model_answer": (
            "Continuous Integration: automatically build and test every change. Continuous Delivery/Deployment: "
            "package and release to production automatically or on demand. Reduces manual release errors, gives fast "
            "feedback and enables small, frequent releases."
        ),
    },
    {
        "text": "What is a container and how does it differ from a virtual machine?",
        "type": "text",
        "time_limit": 300,
        "model_answer": (
            "Containers share the host kernel and isolate processes (namespaces/cgroups) - lightweight, seconds to "
            "start. VMs emulate hardware via a hypervisor - heavier isolation but bigger. Containers package app + "
            "dependencies; images are immutable and portable."
        ),
    },
    # ---- System design ----
    {
        "text": "How would you design a URL shortener?",
        "type": "text",
        "time_limit": 600,
        "model_answer": (
            "Generate a short unique key (base62 of an auto-increment ID with a distributed ID service, or a hash "
            "plus collision check), store mapping in a KV store with TTL/cache, redirect with 301/302, track click "
            "counts asynchronously. Scale by partitioning keys and replicating read-heavy nodes."
        ),
    },
    {
        "text": "What happens behind the scenes of a login form?",
        "type": "text",
        "time_limit": 420,
        "model_answer": (
            "Validate input, look up the user, compare a salted password hash (bcrypt/argon2 - never plaintext), "
            "rate-limit attempts, then issue a session token or signed JWT with short expiry; HTTPS protects the "
            "transmission. Optionally add MFA and audit logging."
        ),
    },
    # ---- Behavioural ----
    {
        "text": "Tell me about a difficult bug you tracked down.",
        "type": "text",
        "time_limit": 420,
        "model_answer": (
            "Strong answers follow: how it was noticed, the hypothesis-driven debugging steps (logs, repro, "
            "bisection), root cause, the fix, and what changed afterwards to prevent recurrence (tests, alerts, "
            "better instrumentation)."
        ),
    },
    {
        "text": "How do you handle disagreements about technical decisions on a team?",
        "type": "text",
        "time_limit": 360,
        "model_answer": (
            "Clarify the shared goal, weigh options with concrete criteria (complexity, cost, risk), time-box the "
            "debate, use a small experiment or prototype to decide, commit to the outcome even if it wasn't your "
            "preference, and revisit with data later."
        ),
    },
    {
        "text": "Why are you interested in this role?",
        "type": "text",
        "time_limit": 300,
        "model_answer": (
            "Connect specific parts of the role to concrete experience and goals: problems you've already solved, "
            "skills you want to deepen, and why this team/product specifically - avoid generic enthusiasm."
        ),
    },
    {
        "text": "Describe a project you are proud of.",
        "type": "text",
        "time_limit": 360,
        "model_answer": (
            "Structure with context, your specific contribution, measurable impact (performance, users, revenue) and "
            "a lesson learned. Emphasise decisions you made, not just the team's outcome."
        ),
    },
]
