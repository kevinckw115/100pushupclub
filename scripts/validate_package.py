#!/usr/bin/env python3
"""Validate this handoff's structure, contracts and design; not the future app."""
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
errors = []

def source_files(suffix):
    """Validate repository sources, excluding installed/generated dependencies."""
    for directory, children, files in os.walk(ROOT):
        children[:] = [name for name in children if name not in {
            '.git', 'node_modules', '.expo', 'dist', 'build', 'coverage', '__pycache__'
        }]
        for name in files:
            if name.endswith(suffix):
                yield Path(directory) / name

def check(condition, message):
    if not condition:
        errors.append(message)

required = [
    'README.md','START_HERE.md','AGENTS.md','PACKAGE_VALIDATION.md',
    'design/DESIGN_SYSTEM.md','design/tokens.json','design/option-5-cream-brick.png',
    'contracts/domain.ts','reference/domain.mjs','fixtures/scenarios.json',
    'tests/domain.test.mjs','tracking/tasks.json','tracking/PROGRESS.md',
    'tracking/EVIDENCE.md','prompts/KICKOFF.md','prompts/RESUME.md',
    'docs/01-product.md','docs/02-decisions.md','docs/03-screens.md',
    'docs/04-architecture.md','docs/05-data-model.md','docs/06-sync.md',
    'docs/07-api.md','docs/08-security.md','docs/09-build-plan.md',
    'docs/10-verification.md','docs/11-release.md','docs/12-setup.md','docs/13-sources.md'
]
for relative in required:
    check((ROOT/relative).is_file(), f'Missing required file: {relative}')

for path in source_files('.md'):
    text = path.read_text(encoding='utf-8')
    check(text.count('```') % 2 == 0, f'Unbalanced code fence: {path.relative_to(ROOT)}')
    for match in re.finditer(r'!?\[[^\]]*\]\(([^\s)]+)\)', text):
        target = match.group(1)
        if target.startswith(('https://','http://','#','mailto:')):
            continue
        target = target.split('#')[0]
        check((path.parent/target).exists(), f'Broken local link in {path.relative_to(ROOT)}: {target}')

for path in source_files('.json'):
    try:
        json.loads(path.read_text(encoding='utf-8'))
    except Exception as exc:
        errors.append(f'Invalid JSON {path.relative_to(ROOT)}: {exc}')

task_data=json.loads((ROOT/'tracking/tasks.json').read_text())
tasks=task_data['tasks']; ids={t['id'] for t in tasks}
check(len(ids)==len(tasks)==23,'Expected 23 uniquely identified implementation tasks')
seen=set()
for task in tasks:
    check(task['status'] in task_data['allowed_statuses'],f"Invalid task status {task['id']}")
    check(all(d in seen for d in task['depends_on']),f"Invalid or unordered dependency for {task['id']}")
    seen.add(task['id'])
plan=(ROOT/'docs/09-build-plan.md').read_text()
check(set(re.findall(r'\| (T\d{2}) ',plan))==ids,'Backlog and task registry differ')
acceptance=(ROOT/'docs/10-verification.md').read_text()
acceptance_ids=re.findall(r'\| (A\d{2}) ',acceptance)
check(len(acceptance_ids)==len(set(acceptance_ids))==37,'Expected 37 unique acceptance scenarios')
check(set(re.findall(r'\bT\d{2}\b',acceptance)).issubset(ids),'Unknown task in acceptance matrix')

tokens=json.loads((ROOT/'design/tokens.json').read_text())
check(tokens['option']==5,'Approved option must be 5')
check(tokens['layout']['tapTargetMin']>=48,'Tap target below package minimum')
for name,value in tokens['colors'].items():
    check(bool(re.fullmatch(r'#[0-9A-Fa-f]{6}',value)),f'Invalid color {name}')

def luminance(color):
    channels=[int(color[i:i+2],16)/255 for i in (1,3,5)]
    linear=[c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4 for c in channels]
    return sum(c*w for c,w in zip(linear,(0.2126,0.7152,0.0722)))

contrasts={}
for foreground,background in [('textPrimary','canvas'),('textSecondary','canvas'),('onAccent','accent'),('textSecondary','surface'),('accent','canvas')]:
    a,b=sorted([luminance(tokens['colors'][foreground]),luminance(tokens['colors'][background])])
    ratio=(b+0.05)/(a+0.05)
    contrasts[f'{foreground}/{background}']=round(ratio,2)
    check(ratio>=4.5,f'Text contrast below 4.5: {foreground}/{background}: {ratio}')

png=ROOT/'design/option-5-cream-brick.png'
check(png.read_bytes()[:8]==b'\x89PNG\r\n\x1a\n','Invalid visual reference PNG')

fixture=json.loads((ROOT/'fixtures/scenarios.json').read_text())
for case in fixture['day_metrics']:
    check(str(sum(case['quantities']))==case['expected']['total'],f"Fixture total mismatch: {case['name']}")

if errors:
    print('\n'.join('FAIL: '+error for error in errors))
    raise SystemExit(1)
print(f'PASS: {len(required)} required files, local links, JSON, 23-task DAG, 37 acceptance scenarios, fixtures and PNG')
print('PASS: text contrast ratios '+json.dumps(contrasts,sort_keys=True))
print('Scope: package integrity only; no mobile/backend/device validation.')
