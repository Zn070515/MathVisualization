/**
 * The `<math-field>` element, as JSX sees it.
 *
 * MathLive ships types for the element class but not for the tag, so the tag is
 * declared here. The element type is the narrow interface this application uses
 * (`MathFieldElementLike`) rather than MathLive's full class: that keeps the couple
 * of places that touch the editor honest about how little of it they depend on, and
 * keeps a future swap of editor to a change in one module.
 */
import type { MathFieldElementLike } from './expression/mathInputAdapter';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'math-field': React.DetailedHTMLProps<
        React.HTMLAttributes<MathFieldElementLike>,
        MathFieldElementLike
      >;
    }
  }
}
