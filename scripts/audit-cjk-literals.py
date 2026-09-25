import re
import pathlib

root = pathlib.Path("src")
hits = []
for p in root.rglob("*.ts"):
    s = p.read_text(encoding="utf-8", errors="replace")
    s2 = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    s2 = re.sub(r"//[^\n]*", "", s2)
    for m in re.finditer(r'(["\'])([^"\'\n]*[一-龥][^"\'\n]*)\1', s2):
        line = s2[: m.start()].count("\n") + 1
        hits.append((str(p).replace("\\", "/"), line, m.group(2)[:100]))

print(len(hits), "user-facing CJK literals")
for f, l, t in hits:
    print(f"{f}:{l}: {t}")
