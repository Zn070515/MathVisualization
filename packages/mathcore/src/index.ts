/**
 * @mathviz/mathcore — the shared mathematical core.
 *
 * Every subsystem of the application is built on this package, and it depends on
 * nothing. That has two consequences worth stating plainly:
 *
 * - There is no third-party runtime dependency. Complex arithmetic, parsing, the
 *   type system and the domain-colouring convention are defined here rather than
 *   delegated, so the project owns its mathematical model. Third-party engines
 *   (SymPy behind an adapter, WebGL behind a renderer) sit behind interfaces.
 * - Nothing in this package knows about the DOM, React, storage or the network.
 *   It is pure functions over mathematical objects, which is what makes the
 *   behaviour directly testable and what keeps the three subsystems sharing one
 *   mathematical truth (GOAL.md 6.1, 23).
 *
 * Module map, in dependency order:
 *
 *   errors.ts       failure vocabulary: parse errors and mathematical issues
 *   rational.ts     exact rational literals
 *   complex.ts      complex arithmetic and branch conventions
 *   conventions.ts  every project-wide mathematical convention, in one table
 *   builtins.ts     the single registry of builtin functions
 *   ast.ts          the canonical abstract syntax tree
 *   lexer.ts        source text to tokens
 *   parser.ts       tokens to the canonical AST
 *   types.ts        spaces, signatures, and object classification
 *   infer.ts        type inference over the AST
 *   evaluator.ts    numerical evaluation, real and complex
 *   display.ts      how a computed number is written, structurally
 *   format.ts       printing expressions and values as mathematics
 *   ticks.ts        where axis ticks go, and what they say
 *   pointsOfInterest.ts  the points on a curve worth naming
 *   zerosAndPoles.ts  where a complex function vanishes, by the argument principle
 *   contour.ts      the integral of a function along a path
 *   surface.ts      sampling a scalar field into a mesh
 *   gradient.ts     numerical gradients and directional derivatives
 *   hessian.ts      numerical Hessians and critical-point classification
 *   fft.ts          radix-2 FFT implementation for the DFT
 *   aliasing.ts     sampling frequency folding and alias relations
 *   convolution.ts  finite-window convolution and sampled DFT products
 *   linearization.ts numerical tangent planes and local approximation error
 *   surfaceGlsl.ts  the fixed shader a surface is drawn with
 *   workspace.ts    a document: many statements, analysed together
 *   coloring.ts     domain colouring, the CPU reference implementation
 *   glsl.ts         lowering the AST to a WebGL2 fragment shader
 *   sympy.ts        lowering the AST to SymPy syntax
 *   cas.ts          the symbolic adapter contract
 */

export * from './errors';
export * from './rational';
export * from './complex';
export * from './conventions';
export * from './builtins';
export * from './ast';
export * from './lexer';
export * from './parser';
export * from './latex';
export * from './types';
export * from './infer';
export * from './evaluator';
export * from './display';
export * from './format';
export * from './ticks';
export * from './pointsOfInterest';
export * from './zerosAndPoles';
export * from './contour';
export * from './fourier';
export * from './fft';
export * from './aliasing';
export * from './dft';
export * from './convolution';
export * from './surface';
export * from './gradient';
export * from './hessian';
export * from './linearization';
export * from './contours';
export * from './surfaceGlsl';
export * from './workspace';
export * from './coloring';
export * from './glsl';
export * from './sympy';
export * from './cas';
