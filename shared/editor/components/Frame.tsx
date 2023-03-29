/* eslint-disable prettier/prettier */
import { observable } from "mobx";
import { observer } from "mobx-react";
import { OpenIcon, BackIcon } from "outline-icons";
import * as React from "react";
import { CSSProperties } from "react";
import styled, { keyframes } from "styled-components";
import Image from "./Image";


import { Optional } from "utility-types";

type Props = Omit<Optional<HTMLIFrameElement>, "children"> & {
  src?: string;
  border?: boolean;
  title?: string;
  icon?: React.ReactNode;
  canonicalUrl?: string;
  isSelected?: boolean;
  width?: string;
  height?: string;
  allow?: string;
};

type PropsWithRef = Props & {
  forwardedRef: React.Ref<HTMLIFrameElement>;
};

@observer
class Frame extends React.Component<PropsWithRef, { membersModalOpen: boolean }> {
  mounted: boolean;
  @observable
  isLoaded = false;
  constructor(props: PropsWithRef) {
    super(props);
    this.escFunction = this.escFunction.bind(this);
    this.state = {
      membersModalOpen: false
    }
  }
  escFunction = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      //Do whatever when esc is pressed
      this.setState({ membersModalOpen: false });

    }
  }
  handleMembersModalOpen = () => {
    console.log('open')
    this.setState({ membersModalOpen: true });
    console.log(this.state.membersModalOpen);
    // alert("Hello\nHow are you?");
  };

  handleMembersModalClose = () => {
    this.setState({ membersModalOpen: false });
    console.log('close')
    console.log(this.state.membersModalOpen);

  };

  componentDidMount() {

    this.mounted = true;
    setImmediate(this.loadIframe);
    document.addEventListener("keydown", this.escFunction, false);

  }

  componentWillUnmount() {
    this.mounted = false;
    document.removeEventListener("keydown", this.escFunction, false);

  }

  loadIframe = () => {
    if (!this.mounted) {
      return;
    }
    this.isLoaded = true;
  };

  //  iframeclick = () => {
  //   document.getElementById("abc").contentWindow.document.body.onclick = function() {
  //           document.getElementById("abc").contentWindow.location.reload();
  //       }
  //   }


  render() {
    const {
      border,
      width = "100%",
      height = "400px",
      forwardedRef,
      icon,
      title,
      canonicalUrl,
      isSelected,
      referrerPolicy,
      src,
    } = this.props;
    const withBar = !!(icon || canonicalUrl);
    console.log('mount', withBar);

    return (
      <Rounded
        width={width}
        height={height}
        $withBar={withBar}
        $border={border}
        className={isSelected ? "ProseMirror-selectednode" : ""}
      >

        {this.isLoaded && (
          <Iframe
            ref={forwardedRef}
            $withBar={withBar}
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-downloads"
            width={width}
            height={height}
            frameBorder="0"
            title="embed"
            loading="lazy"
            src={src}
            referrerPolicy={referrerPolicy}
            allowFullScreen

          />
        )}

        {withBar ? (

          <Bar>
            {icon} <Title>{title}</Title>

            <Button $withBar={withBar} onClick={this.handleMembersModalOpen}>
              <OpenIcon color="currentColor" size={18} />Zoom
            </Button>
            {canonicalUrl && (
              <Open
                href={canonicalUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <OpenIcon color="currentColor" size={18} /> Open
              </Open>
            )}
          </Bar>

        ) : (<Bar>
          
        <Title> </Title>
          <Button $withBar={withBar} onClick={this.handleMembersModalOpen}>
            <OpenIcon color="currentColor" size={18} />Zoom
          </Button>
          {canonicalUrl && (
            <Open
              href={canonicalUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <OpenIcon color="currentColor" size={18} /> Open
            </Open>
          )}
        </Bar>)
        }
        {this.state.membersModalOpen && (
          // <Backdrop></Backdrop>
          <Modal>
            <ModalContent>
              <ButtonBack onClick={this.handleMembersModalClose}>
                <BackIcon color="currentColor" size={18} /> Back
              </ButtonBack>
              <Iframe
                id="abc"
                ref={forwardedRef}
                $withBar={withBar}
                sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-downloads"
                width={width}
                height={screen.height * 0.8}
                frameBorder="0"
                title="embed"
                loading="lazy"
                src={src}
                referrerPolicy={referrerPolicy}
                allowFullScreen

              />
            </ModalContent>
          </Modal>
        )}
      </Rounded>
    );
  }
}

const Iframe = styled.iframe<{ $withBar: boolean }>`
  border-radius: ${(props) => (props.$withBar ? "3px 3px 0 0" : "3px")};
  display: block;
`;
const Button = styled.button<{ $withBar: boolean }>`

  color: ${(props) => props.theme.textSecondary} !important;
  font-size: 13px;
  font-weight: 500;
  align-items: center;
  display: flex;
  position: absolute;
  right: ${(props) => (props.$withBar ? "56px" : "0")}; 
  padding: 0 8px;
  border: none;
  background: none;
`;
const ButtonBack = styled.button`
display: flex;
align-items: center;
color: inherit;
padding: 32px;
font-weight: 500;

svg {
  transition: transform 100ms ease-in-out;
}

&:hover {
  svg {
    transform: translateX(-4px);
  }
}
border: none;
background: none;
`;
const Rounded = styled.div<{
  width: string;
  height: string;
  $withBar: boolean;
  $border?: boolean;
}>`
  border: 1px solid
    ${(props) => (props.$border ? props.theme.embedBorder : "transparent")};
  border-radius: 6px;
  overflow: hidden;
  width: ${(props) => props.width};
  height: ${(props) => (props.height + 28)};
`;

const Open = styled.a`
  color: ${(props) => props.theme.textSecondary} !important;
  font-size: 13px;
  font-weight: 500;
  align-items: center;
  display: flex;
  position: absolute;
  right: 0;
  padding: 0 8px;
`;

const Title = styled.span`
  font-size: 13px;
  font-weight: 500;
  padding-left: 4px;
`;

const Bar = styled.div`
  display: flex;
  align-items: center;
  border-top: 1px solid ${(props) => props.theme.embedBorder};
  background: ${(props) => props.theme.secondaryBackground};
  color: ${(props) => props.theme.textSecondary};
  padding: 0 8px;
  border-bottom-left-radius: 6px;
  border-bottom-right-radius: 6px;
  user-select: none;
`;
const fadeAndScaleIn = keyframes`
  from {
    opacity: 0;
    transform: scale(.98);
  }

  to {
    opacity: 1;
    transform: scale(1);
  }
`;
const Modal = styled.div`
animation: ${fadeAndScaleIn} 250ms ease;
display: block; 
position: fixed; 
z-index: 3000;
left: 0;
top: 0;
width: 100%;
height: 100%; 
overflow: auto; 
background: ${(props) => props.theme.danger};
transition: ${(props) => props.theme.backgroundTransition};
outline: none;
box-shadow: 0 -2px 10px ${(props) => props.theme.shadow};
border-radius: 8px 0 0 8px;
overflow: hidden;
justify-content: center;
align-items: center;
`;

const ModalContent = styled.div`
background-color: #fefefe;
padding-bottom: 20px;
padding-top: 20px;
border: 1px solid #888;
width: 100%;
height:100%;
overflow-y: scroll;
align-items: center;
justify-content: center;
`;

// const Close = styled.span`
// color: #aaa;
//   float: right;
//   font-size: 28px;
//   font-weight: bold;
// `;
type JustifyValues = CSSProperties["justifyContent"];

type AlignValues = CSSProperties["alignItems"];
const Backdrop = styled.div<{
  auto?: boolean;
  column?: boolean;
  align?: AlignValues;
  justify?: JustifyValues;
  shrink?: boolean;
  reverse?: boolean;
  gap?: number;
}>`
  display: flex;
  flex: ${({ auto }) => (auto ? "1 1 auto" : "initial")};
  flex-direction: ${({ column, reverse }) =>
    reverse
      ? column
        ? "column-reverse"
        : "row-reverse"
      : column
        ? "column"
        : "row"};
  align-items: ${({ align }) => align};
  justify-content: ${({ justify }) => justify};
  flex-shrink: ${({ shrink }) => (shrink ? 1 : "initial")};
  gap: ${({ gap }) => (gap ? `${gap}px` : "initial")};
  min-height: 0;
  min-width: 0;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: ${(props) => props.theme.modalBackdrop} !important;
  z-index: 2000;
  transition: opacity 50ms ease-in-out;
  opacity: 0;

  &[data-enter] {
    opacity: 1;
  }
`;



export default React.forwardRef<HTMLIFrameElement, Props>((props, ref) => (
  <Frame {...props} forwardedRef={ref} />
));
