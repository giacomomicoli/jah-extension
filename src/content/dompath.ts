/**
 * Compact structural paths used as DOM *hints*: "div:1/p:4/#text:0" means
 * root → 2nd <div> child → 5th <p> child → 1st text child. Never an identity.
 */
export function nodePath(node: Node, root: Node): string | null {
  const steps: string[] = [];
  let current: Node | null = node;
  while (current && current !== root) {
    const parent: Node | null = current.parentNode;
    if (!parent) return null;
    steps.push(`${stepName(current)}:${siblingIndex(current)}`);
    current = parent;
  }
  return current === root ? steps.reverse().join('/') : null;
}

export function resolveNodePath(path: string, root: Node): Node | null {
  if (!path) return root;
  let current: Node = root;
  for (const step of path.split('/')) {
    const colon = step.lastIndexOf(':');
    if (colon <= 0) return null;
    const name = step.slice(0, colon);
    const index = Number(step.slice(colon + 1));
    if (!Number.isInteger(index) || index < 0) return null;
    let seen = 0;
    let next: Node | null = null;
    for (let child = current.firstChild; child; child = child.nextSibling) {
      if (stepName(child) !== name) continue;
      if (seen++ === index) {
        next = child;
        break;
      }
    }
    if (!next) return null;
    current = next;
  }
  return current;
}

function stepName(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return '#text';
  if (node.nodeType === Node.ELEMENT_NODE) return (node as Element).localName;
  return `#${node.nodeType}`;
}

function siblingIndex(node: Node): number {
  const name = stepName(node);
  let index = 0;
  for (let sibling = node.previousSibling; sibling; sibling = sibling.previousSibling) {
    if (stepName(sibling) === name) index++;
  }
  return index;
}
