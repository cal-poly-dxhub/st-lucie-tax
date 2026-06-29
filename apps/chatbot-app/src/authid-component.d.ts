import "react";
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "authid-component": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { "data-url"?: string; "data-webauth"?: string },
        HTMLElement
      >;
    }
  }
}
