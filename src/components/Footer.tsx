import * as React from 'react';

export const CLIENT_VERSION = 'v2.20.12';

export function VersionLink(props: { version: string }) {
  return (
    <a href="https://github.com/adamleger0/wumuncoordinated">
      {props.version}
    </a>
  );
}

export default class Footer extends React.PureComponent<{}> {
  render() {
    return (
      <div
        style={{
          position: 'fixed',
          bottom: 5,
          left: 5,
          background: 'var(--wumun-bg)',
          color: 'var(--wumun-text-dark)',
          padding: '2px 6px',
          borderRadius: 4,
          border: '1px solid rgba(22, 22, 28, 0.15)',
          zIndex: 10,
        }}
      >
        WUMUN (<VersionLink version={CLIENT_VERSION} />)
      </div>
    );
  }
}
