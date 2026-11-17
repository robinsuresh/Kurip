import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKnowledgeGraph, findNodeAtPosition, stepGraphSimulation } from './graph';
import { Note } from '../types/vault';

test('buildKnowledgeGraph creates nodes and deduplicated edges from wikilinks', () => {
  const notes: Note[] = [
    { id: 'a', title: 'Alpha', folder: '', content: 'Links to [[Beta]] and [[Beta]].', createdAt: 1, updatedAt: 1 },
    { id: 'b', title: 'Beta', folder: '', content: 'Links back to [[Alpha]].', createdAt: 1, updatedAt: 1 },
    { id: 'c', title: 'Orphan', folder: '', content: 'No links.', createdAt: 1, updatedAt: 1 },
  ];

  const graph = buildKnowledgeGraph(notes, 800, 600);
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.nodes[0].degree, 1);
  assert.equal(graph.nodes[2].degree, 0);
});

test('stepGraphSimulation produces finite coordinates and findNodeAtPosition resolves hits', () => {
  const notes: Note[] = [
    { id: 'a', title: 'Alpha', folder: '', content: '[[Beta]]', createdAt: 1, updatedAt: 1 },
    { id: 'b', title: 'Beta', folder: '', content: '', createdAt: 1, updatedAt: 1 },
  ];

  const graph = buildKnowledgeGraph(notes, 800, 600);
  for (let i = 0; i < 30; i++) {
    stepGraphSimulation(graph.nodes, graph.edges, 400, 300);
  }
  for (const n of graph.nodes) {
    assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
  }
  const hit = findNodeAtPosition(graph.nodes, graph.nodes[0].x, graph.nodes[0].y);
  assert.equal(hit?.id, graph.nodes[0].id);
});
