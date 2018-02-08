import {
    Reader,
    BinaryBitmap,
    HybridBinarizer,
    Result,
    Exception,
    HTMLCanvasElementLuminanceSource,
} from '@barn/zxing';

/**
 * Based on Zxing-typescript BrowserCodeReader
 */
export class BrowserCodeReader {

    /**
     * The HTML video element, used to display the camera stream.
     */
    private videoElement: HTMLVideoElement;
    private imageElement: HTMLImageElement;
    private canvasElement: HTMLCanvasElement;
    private canvasElementContext: CanvasRenderingContext2D;
    private timeoutHandler: number;
    /**
     * The stream output from camera.
     */
    private stream: MediaStream;
    private videoPlayEndedEventListener: EventListener;
    private videoPlayingEventListener: EventListener;
    private videoLoadedMetadataEventListener: EventListener;
    private imageLoadedEventListener: EventListener;

    /**
     * Constructor for dependency injection.
     *
     * @param reader The barcode reader to be used to decode the stream.
     * @param timeBetweenScans The scan throttling in milliseconds.
     */
    public constructor(private reader: Reader, private timeBetweenScans: number = 500) { }

    /**
     * Starts the decoding from the actual or a new video element.
     *
     * @param callbackFn The callback to be executed after every scan attempt
     * @param deviceId The device's to be used Id
     * @param videoElement A new video element
     */
    public decodeFromInputVideoDevice(callbackFn: (result: Result) => any, deviceId?: string, videoElement?: HTMLVideoElement): void {

        this.reset();

        this.prepareVideoElement(videoElement);

        const video = deviceId === undefined
            ? { facingMode: { exact: 'environment' } }
            : { deviceId: { exact: deviceId } };

        const constraints: MediaStreamConstraints = {
            audio: false,
            video
        };

        navigator
            .mediaDevices
            .getUserMedia(constraints)
            .then((stream: MediaStream) => this.startDecodeFromStream(stream, callbackFn))
            .catch((err: any) => {
                /* handle the error, or not */
                console.error(err);
            });
    }

    /**
     * Sets the new stream and request a new decoding-with-delay.
     *
     * @param stream The stream to be shown in the video element.
     * @param callbackFn A callback for the decode method.
     */
    private startDecodeFromStream(stream: MediaStream, callbackFn: (result: Result) => any): void {

        this.stream = stream;

        // Older browsers may not have srcObject
        if ('srcObject' in this.videoElement) {
            // @NOTE a play request was interrupted by a new loaded request
            // @throws Exception
            this.videoElement.srcObject = stream;
        } else {
            // Avoid using this in new browsers, as it is going away.
            this.videoElement.src = window.URL.createObjectURL(stream);
        }

        this.videoPlayingEventListener = () => {
            this.decodeWithDelay(callbackFn);
        };

        this.videoElement.addEventListener('playing', this.videoPlayingEventListener);

        this.videoLoadedMetadataEventListener = () => {
            this.videoElement.play();
        };

        this.videoElement.addEventListener('loadedmetadata', this.videoLoadedMetadataEventListener);
    }

    /**
     * Sets a HTMLVideoElement for scanning or creates a new one.
     *
     * @param videoElement The HTMLVideoElement to be set.
     */
    private prepareVideoElement(videoElement?: HTMLVideoElement) {
        if (!videoElement) {
            this.videoElement = document.createElement('video');
            this.videoElement.width = 200;
            this.videoElement.height = 200;
        } else {
            this.videoElement = videoElement;
        }
    }

    /**
     *
     * @param callbackFn
     */
    private decodeWithDelay(callbackFn: (result: Result) => any): void {
        this.timeoutHandler = window.setTimeout(this.decode.bind(this, callbackFn), this.timeBetweenScans);
    }

    /**
     * Does the real image decoding job.
     *
     * @param callbackFn
     * @param retryIfNotFound
     * @param retryIfChecksumOrFormatError
     * @param once
     */
    private decode(
        callbackFn: (result: Result) => any,
        retryIfNotFound: boolean = true,
        retryIfChecksumOrFormatError: boolean = true,
        once = false
    ): void {

        if (undefined === this.canvasElementContext) {
            this.prepareCaptureCanvas();
        }

        this.canvasElementContext.drawImage(this.videoElement || this.imageElement, 0, 0);

        // @note generates zone.js error when switching cameras
        const luminanceSource = new HTMLCanvasElementLuminanceSource(this.canvasElement);
        const binaryBitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource));

        try {

            const result = this.readerDecode(binaryBitmap);

            callbackFn(result);

            if (!once && !!this.stream) {
                setTimeout(() => this.decodeWithDelay(callbackFn), this.timeBetweenScans);
            }

        } catch (re) {

            console.log(retryIfChecksumOrFormatError, re);

            if (retryIfNotFound && Exception.isOfType(re, Exception.NotFoundException)) {
                console.warn('Not found, trying again...');

                this.decodeWithDelay(callbackFn);
            } else if (
                retryIfChecksumOrFormatError &&
                (
                    Exception.isOfType(re, Exception.ChecksumException) ||
                    Exception.isOfType(re, Exception.FormatException)
                )
            ) {
                console.log('Checksum or format error, trying again...', re);

                this.decodeWithDelay(callbackFn);
            }
        }
    }

    /**
     * Alias for this.reader.decode
     *
     * @param binaryBitmap
     */
    protected readerDecode(binaryBitmap: BinaryBitmap): Result {
        return this.reader.decode(binaryBitmap);
    }

    /**
     *
     */
    private prepareCaptureCanvas() {

        const canvasElement = document.createElement('canvas');

        let width: number;
        let height: number;

        if (undefined !== this.videoElement) {
            width = this.videoElement.videoWidth;
            height = this.videoElement.videoHeight;
        } else {
            width = this.imageElement.naturalWidth || this.imageElement.width;
            height = this.imageElement.naturalHeight || this.imageElement.height;
        }

        canvasElement.style.width = width + 'px';
        canvasElement.style.height = height + 'px';
        canvasElement.width = width;
        canvasElement.height = height;

        this.canvasElement = canvasElement;
        this.canvasElementContext = canvasElement.getContext('2d');
    }

    /**
     * Stops the continuous scan and cleans the stream.
     */
    private stop(): void {

        if (this.timeoutHandler) {
            window.clearTimeout(this.timeoutHandler);
            this.timeoutHandler = null;
        }

        if (this.stream) {
            // @TODO see if the `stop` is not responsible for the cam switch error
            this.stream.getTracks()[0].stop();
            this.stream = null;
        }

    }

    /**
     * Resets the scanner and it's configurations.
     */
    public reset(): void {

        this.stop();

        if (undefined !== this.videoElement) {

            this.videoElement.srcObject = undefined;
            this.videoElement.removeAttribute('src');
            this.videoElement = undefined;

            if (undefined !== this.videoPlayEndedEventListener) {
                this.videoElement.removeEventListener('ended', this.videoPlayEndedEventListener);
            }

            if (undefined !== this.videoPlayingEventListener) {
                this.videoElement.removeEventListener('playing', this.videoPlayingEventListener);
            }

            if (undefined !== this.videoLoadedMetadataEventListener) {
                this.videoElement.removeEventListener('loadedmetadata', this.videoLoadedMetadataEventListener);
            }
        }

        if (undefined !== this.imageElement) {

            this.imageElement.src = undefined;
            this.imageElement.removeAttribute('src');
            this.imageElement = undefined;

            if (undefined !== this.videoPlayEndedEventListener) {
                this.imageElement.removeEventListener('load', this.imageLoadedEventListener);
            }
        }

        this.canvasElementContext = undefined;
        this.canvasElement = undefined;
    }
}
