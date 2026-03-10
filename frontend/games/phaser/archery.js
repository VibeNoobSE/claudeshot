registerGame("archery", "🏹 Archery", "SPACE = P1 shoot, ENTER = P2 shoot", "Hit the moving targets for points!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a2e1a");
    this.s1=0;this.s2=0;this.arrows=1;this.totalArrows=10;
    this.targets=[];
    for(let i=0;i<3;i++){
      const t=this.add.circle(W/2+Phaser.Math.Between(-200,200),80+i*130,30+i*10,0x000000);
      t.setStrokeStyle(3,0xe94560);
      this.add.circle(t.x,t.y,15,0xe94560);this.add.circle(t.x,t.y,6,0xf7c948);
      this.targets.push({x:t.x,y:t.y,r:30+i*10,pts:3-i});
    }
    this.p1Arrow=this.add.triangle(200,H-40,0,-12,6,8,-6,8,0xf7c948);
    this.p2Arrow=this.add.triangle(W-200,H-40,0,-12,6,8,-6,8,0xe94560);
    this.p1Power=0;this.p2Power=0;this.p1Charging=false;this.p2Charging=false;
    this.powerBar1=this.add.rectangle(200,H-10,0,8,0xf7c948);
    this.powerBar2=this.add.rectangle(W-200,H-10,0,8,0xe94560);
    this.sTxt=this.add.text(W/2,H-20,"P1: 0 | P2: 0 ("+this.totalArrows+" arrows each)",{fontSize:"16px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.input.keyboard.on("keydown-SPACE",()=>{this.p1Charging=true;});
    this.input.keyboard.on("keyup-SPACE",()=>{this.fireArrow(this.p1Arrow,this.p1Power,"P1");this.p1Charging=false;this.p1Power=0;this.powerBar1.width=0;});
    this.input.keyboard.on("keydown-ENTER",()=>{this.p2Charging=true;});
    this.input.keyboard.on("keyup-ENTER",()=>{this.fireArrow(this.p2Arrow,this.p2Power,"P2");this.p2Charging=false;this.p2Power=0;this.powerBar2.width=0;});
  }
  fireArrow(arrow,power,who){
    const tx=W/2+Phaser.Math.Between(-30,30)*(1-power/100);
    const ty=Phaser.Math.Between(40,350);
    const marker=this.add.circle(tx,ty,4,who==="P1"?0xf7c948:0xe94560);
    this.targets.forEach(t=>{
      if(Phaser.Math.Distance.Between(tx,ty,t.x,t.y)<t.r){
        const pts=t.pts*(power>70?2:1);
        if(who==="P1")this.s1+=pts;else this.s2+=pts;
        this.sTxt.setText("P1: "+this.s1+" | P2: "+this.s2);
      }
    });
    this.arrows++;
    if(this.arrows>this.totalArrows*2){this.add.text(W/2,H/2,(this.s1>this.s2?"P1":"P2")+" WINS!",{fontSize:"36px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);}
  }
  update(){
    if(this.p1Charging&&this.p1Power<100){this.p1Power+=2;this.powerBar1.width=this.p1Power;}
    if(this.p2Charging&&this.p2Power<100){this.p2Power+=2;this.powerBar2.width=this.p2Power;}
  }
});
